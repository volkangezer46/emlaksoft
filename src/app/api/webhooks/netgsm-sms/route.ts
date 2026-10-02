import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  fingerprintNetgsmFields,
  netgsmInboxPayload,
  parseNetgsmInbound,
} from "@/lib/webhooks/netgsm-contract";
import {
  ingestNetgsmInbound,
  quarantineNetgsmEvent,
} from "@/lib/webhooks/netgsm-inbound";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function secretMatches(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function quarantineEvidence(fields: Record<string, string>): Record<string, unknown> {
  return { field_names: Object.keys(fields).sort().slice(0, 64) };
}

function addScalarFields(target: Record<string, string>, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" || typeof entry === "number") {
      target[key.toLowerCase()] = String(entry);
    }
  }
}

async function collectFields(req: NextRequest): Promise<Record<string, string> | null> {
  const fields: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key.toLowerCase() !== "secret") fields[key.toLowerCase()] = value;
  });

  const bytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bytes === null) return null;
  if (bytes.byteLength === 0) return fields;

  const text = new TextDecoder().decode(bytes);
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    addScalarFields(fields, JSON.parse(text) as unknown);
    return fields;
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    !contentType ||
    contentType.startsWith("text/plain")
  ) {
    new URLSearchParams(text).forEach((value, key) => {
      fields[key.toLowerCase()] = value;
    });
    return fields;
  }

  throw new Error("unsupported_content_type");
}

/**
 * Netgsm Gelen SMS callback.
 *
 * Official payload identity is messageId; exact tenant routing is exclusively
 * subscriberNumber -> tenant_integrations.external_account_id. Customer phone
 * matches never choose a tenant. Every accepted delivery is first claimed in
 * webhook_events, so provider retries are idempotent.
 */
export async function POST(req: NextRequest) {
  const expectedSecret = process.env.NETGSM_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) return json({ ok: false, error: "not_configured" }, 503);

  const actualSecret =
    req.headers.get("x-webhook-secret")?.trim() ??
    req.nextUrl.searchParams.get("secret")?.trim() ??
    "";
  if (!secretMatches(actualSecret, expectedSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  let fields: Record<string, string> | null;
  try {
    fields = await collectFields(req);
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  if (fields === null) return json({ ok: false, error: "payload_too_large" }, 413);

  const parsed = parseNetgsmInbound(fields);
  if (!parsed.ok) {
    const quarantined = await quarantineNetgsmEvent({
      providerEventId: fingerprintNetgsmFields(fields),
      payload: quarantineEvidence(fields),
      reason: parsed.reason,
    });
    return json(
      { ok: quarantined.ok, quarantined: quarantined.ok, reason: parsed.reason },
      quarantined.ok ? 202 : 500,
    );
  }

  const result = await ingestNetgsmInbound(parsed.value, netgsmInboxPayload(parsed.value));
  if (!result.ok) return json({ ok: false, error: result.reason ?? "processing_failed" }, 503);
  if (result.quarantined) {
    return json({ ok: true, quarantined: true, reason: result.reason }, 202);
  }
  return json({ ok: true, duplicate: result.duplicate ?? false });
}
