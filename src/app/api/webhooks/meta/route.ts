import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";
import {
  parseMetaWebhookBytes,
  verifyMetaSignature,
} from "@/lib/webhooks/meta-contract";
import {
  ingestMetaDeliveryStatus,
  ingestMetaInboundMessage,
} from "@/lib/webhooks/meta-inbound";

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

/**
 * Meta WhatsApp webhook.
 *
 * GET reflects the subscription challenge after constant-time verify-token
 * comparison. POST authenticates the exact raw bytes before parsing JSON.
 * Tenant routing uses the signed WABA ID + metadata.phone_number_id pair and
 * only a healthy Meta-verified immutable binding; sender addresses never
 * select a tenant. Outbound delivery receipts use the same tenant boundary and a
 * monotonic provider-status transition, because Meta may deliver them out of
 * order.
 */
export async function GET(req: NextRequest) {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) return json({ ok: false, error: "not_configured" }, 503);

  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token") ?? "";
  const challenge = sp.get("hub.challenge");

  if (
    mode === "subscribe" &&
    secretMatches(token, verifyToken) &&
    challenge &&
    challenge.length <= 512
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return json({ ok: false, error: "verification_failed" }, 403);
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return json({ ok: false, error: "not_configured" }, 503);

  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }
  const bodyBytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bodyBytes === null) return json({ ok: false, error: "payload_too_large" }, 413);

  // Meta signs the exact network bytes, not a decoded or re-serialized string.
  if (!verifyMetaSignature(appSecret, bodyBytes, req.headers.get("x-hub-signature-256"))) {
    console.warn("[meta-webhook] rejected", { reason: "bad_signature" });
    return json({ ok: false, error: "bad_signature" }, 401);
  }

  const parsed = parseMetaWebhookBytes(bodyBytes);
  if (!parsed.ok) {
    console.warn("[meta-webhook] rejected", { reason: parsed.reason });
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  let ingested = 0;
  let quarantined = 0;
  let deliveryStatuses = 0;
  let unmatchedStatuses = 0;
  let failed = 0;
  for (const item of parsed.messages) {
    try {
      const result = await ingestMetaInboundMessage(
        item.message,
        item.phoneNumberId,
        item.wabaId,
        item.eventPayload,
      );
      if (!result.ok) failed += 1;
      else if (result.quarantined) quarantined += 1;
      else if (!result.duplicate) ingested += 1;
    } catch {
      failed += 1;
      console.error("[meta-webhook] item processing failed", { reason: "unhandled_error" });
    }
  }
  for (const status of parsed.statuses) {
    try {
      const result = await ingestMetaDeliveryStatus(status);
      if (!result.ok) failed += 1;
      else if (result.quarantined) quarantined += 1;
      else if (result.reason === "provider_message_not_found") unmatchedStatuses += 1;
      else if (!result.duplicate) deliveryStatuses += 1;
    } catch {
      failed += 1;
      console.error("[meta-webhook] status processing failed", { reason: "unhandled_error" });
    }
  }

  console.info("[meta-webhook] batch complete", {
    ingested,
    quarantined,
    deliveryStatuses,
    unmatchedStatuses,
    ignoredChanges: parsed.ignoredChanges,
    ignoredStatuses: parsed.ignoredStatuses,
    failed,
  });

  // A 2xx response would stop provider retries for every failed item in the
  // batch. Successful items are safe on retry because each message is claimed.
  if (failed > 0) return json({ ok: false, error: "processing_failed" }, 503);
  return json({ ok: true });
}
