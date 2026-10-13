import { NextRequest, NextResponse } from "next/server";
import { now } from "@/lib/clock";
import { createAdminClient } from "@/lib/supabase/admin";
import { readRequestBodyLimited, requestBodyTooLarge } from "@/lib/public-request-security";
import { getBridgeSecret, verifyBridgeSignature } from "@/lib/eids/inbound-crypto";
import { resolveInboundAddress } from "@/lib/eids/inbound-address";
import { createSupabaseInboundStore, processInboundMail, reportUnknownFormat } from "@/lib/eids/inbound";
import { ledgerApplier } from "@/lib/eids/inbound-ledger";
import { MAX_MAIL_BYTES } from "@/lib/eids/inbound-policy";
import { EIDS_SPF_IPS, type MailAuthEvidence } from "@/lib/eids/mail-auth";

export const dynamic = "force-dynamic";

/** base64 ham (256 KB → ~342 KB) + kanıt JSON'u için tavan. */
const MAX_REQUEST_BYTES = 512 * 1024;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");

/** Köprüden gelen mailauth özetini dar bir şemaya indirger (fazla alan ve aşırı uzun değer atılır). */
function sanitizeEvidence(v: unknown): MailAuthEvidence | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const dkim = Array.isArray(e.dkim)
    ? e.dkim.slice(0, 5).map((d) => ({ domain: str((d as Record<string, unknown>)?.domain, 253).toLowerCase(), result: str((d as Record<string, unknown>)?.result, 16) }))
    : [];
  const arcRaw = e.arc as Record<string, unknown> | null | undefined;
  const arc =
    arcRaw && typeof arcRaw === "object"
      ? {
          result: str(arcRaw.result, 16),
          sets: (Array.isArray(arcRaw.sets) ? arcRaw.sets : []).slice(0, 10).map((s) => {
            const o = s as Record<string, unknown>;
            return { i: Number(o?.i) || 0, sealer: str(o?.sealer, 253).toLowerCase(), aar: str(o?.aar, 2000) };
          }),
        }
      : null;
  const spfRaw = e.spf as Record<string, unknown> | null | undefined;
  const dmarcRaw = e.dmarc as Record<string, unknown> | null | undefined;
  return {
    dkim,
    arc,
    spf: spfRaw && typeof spfRaw === "object" ? { result: str(spfRaw.result, 16), domain: str(spfRaw.domain, 253).toLowerCase() || null } : null,
    dmarc: dmarcRaw && typeof dmarcRaw === "object" ? { result: str(dmarcRaw.result, 16) } : null,
  };
}

/**
 * SMTP köprüsü (infra/eids-inbound) → uygulama. HMAC-SHA256 imzası (x-eids-timestamp + x-eids-signature,
 * EIDS_INBOUND_SECRET) doğrulanmadan hiçbir şey okunmaz/yazılmaz; anahtar tanımlı değilse 503 (kapalı kapı).
 *  - op "rcpt":    RCPT TO aşamasında adres denetimi → { accept }. Bilinmeyen/yenilenmiş anahtar = accept:false
 *                  (köprü 550 döner; gövde hiç alınmaz).
 *  - op "deliver": kabul edilen e-posta (base64 ham + mailauth kanıtı) → yönlendirici. İdempotent: aynı Message-ID /
 *                  gövde ikinci kez gelirse "duplicate" döner (köprü yeniden denemesi güvenli).
 * Resend inbound alternatifi bu uca bağlanmadı (RESEND anahtarı kapalı); açılırsa Svix imzalı ayrı bir dal gerekir.
 */
export async function POST(req: NextRequest) {
  const secret = getBridgeSecret();
  if (!secret) return json({ ok: false, error: "not_configured" }, 503);
  if (requestBodyTooLarge(req.headers, MAX_REQUEST_BYTES)) return json({ ok: false, error: "payload_too_large" }, 413);
  const bytes = await readRequestBodyLimited(req, MAX_REQUEST_BYTES);
  if (bytes === null) return json({ ok: false, error: "payload_too_large" }, 413);
  const body = new TextDecoder().decode(bytes);
  const valid = verifyBridgeSignature({
    secret,
    ts: req.headers.get("x-eids-timestamp"),
    signature: req.headers.get("x-eids-signature"),
    body,
    nowSec: Math.floor(now() / 1000),
  });
  if (!valid) return json({ ok: false, error: "unauthorized" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  const op = payload.op;
  const rcpt = str(payload.rcpt, 320);
  if (!rcpt || (op !== "rcpt" && op !== "deliver")) return json({ ok: false, error: "invalid_payload" }, 400);

  try {
    const admin = createAdminClient();
    const address = await resolveInboundAddress(admin, rcpt);
    if (op === "rcpt") return json({ ok: true, accept: Boolean(address) });
    if (!address) return json({ ok: false, error: "unknown_recipient" }, 404);

    const raw = Buffer.from(str(payload.raw_b64, MAX_REQUEST_BYTES), "base64");
    if (raw.length === 0) return json({ ok: false, error: "invalid_payload" }, 400);
    if (raw.length > MAX_MAIL_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);

    const result = await processInboundMail(
      createSupabaseInboundStore(admin, { onUnknownFormat: reportUnknownFormat }),
      ledgerApplier(admin),
      {
        tenantId: address.tenantId,
        addressId: address.id,
        via: payload.via === "resend" ? "resend" : "smtp",
        raw: raw.toString("latin1"),
        evidence: sanitizeEvidence(payload.evidence),
        // Doğrudan teslim = SMTP istemcisi Bakanlık SPF adreslerinden biri (iletilmemiş); yalnız SPF+DMARC kuralı için.
        direct: (EIDS_SPF_IPS as readonly string[]).includes(str(payload.client_ip, 64)),
        actorId: null,
      },
    );
    if (!result.ok) return json({ ok: false, error: "processing_failed" }, 500);
    return json({ ok: true, outcome: result.outcome, auth: result.auth });
  } catch (e) {
    console.error("eids inbound", e instanceof Error ? e.message : "unknown");
    return json({ ok: false, error: "processing_failed" }, 500);
  }
}
