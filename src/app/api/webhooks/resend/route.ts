import { NextRequest, NextResponse } from "next/server";
import { now } from "@/lib/clock";
import { applyResendEvent, parseResendEvent, resolveWebhookSecret, verifySvixSignature } from "@/lib/email/webhook";
import { PUBLIC_REQUEST_MAX_BYTES, readRequestBodyLimited, requestBodyTooLarge } from "@/lib/public-request-security";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Resend webhook'u (Resend > Webhooks: https://emlaksoft.com.tr/api/webhooks/resend; olaylar email.*).
 * İmza (Svix) doğrulanmadan hiçbir şey yazılmaz; anahtar tanımlı değilse 503 (kapalı kapı). Olay işleme
 * `src/lib/email/webhook.ts`: günlük durumu, olay kaydı (svix-id ile idempotent), bounce/şikâyet bastırması.
 */
export async function POST(req: NextRequest) {
  const secret = await resolveWebhookSecret();
  if (!secret) return json({ ok: false, error: "not_configured" }, 503);
  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) return json({ ok: false, error: "payload_too_large" }, 413);

  const bytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bytes === null) return json({ ok: false, error: "payload_too_large" }, 413);
  const body = new TextDecoder().decode(bytes);

  const id = req.headers.get("svix-id");
  const valid = verifySvixSignature({
    id,
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
    body,
    secret,
    nowSec: Math.floor(now() / 1000),
  });
  if (!valid || !id) return json({ ok: false, error: "unauthorized" }, 401);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  const ev = parseResendEvent(parsed);
  if (!ev) return json({ ok: false, error: "invalid_payload" }, 400);

  try {
    const result = await applyResendEvent(id, ev);
    // Günlük satırı henüz yazılmamış (yarış): 503 ile Resend'in yeniden denemesi istenir.
    if (result === "pending") return json({ ok: false, result }, 503);
    return json({ ok: true, result });
  } catch (e) {
    console.error("resend webhook", e instanceof Error ? e.message : "unknown");
    // 5xx: Resend yeniden dener (işlem idempotent).
    return json({ ok: false, error: "processing_failed" }, 500);
  }
}
