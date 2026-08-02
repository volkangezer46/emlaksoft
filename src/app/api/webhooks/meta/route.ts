import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";
import { ingestMetaInboundMessage, type MetaInboundMessage } from "@/lib/webhooks/meta-inbound";

/**
 * Meta (WhatsApp Business) webhook ucu.
 *
 * GET  → Meta'nın webhook doğrulama el sıkışması (hub.challenge yansıtma).
 * POST → X-Hub-Signature-256 imza kontrolü, sonra her `messages[]` girdisi
 *        Netgsm SMS inbound akışıyla aynı iskeletle (bkz. meta-inbound.ts)
 *        `communications` tablosuna yazılır. Tenant SADECE Meta'nın
 *        phone_number_id'sinden çözülür — müşteri numarasından asla.
 *        Delivery/read status webhook'ları (`value.statuses[]`) kasıtlı
 *        olarak ele alınmıyor; giden WhatsApp gönderimi henüz yok.
 *
 * Env:
 *   META_VERIFY_TOKEN — Meta panelinde webhook kurarken girilen doğrulama token'ı
 *   META_APP_SECRET   — uygulama gizli anahtarı (imza HMAC'i bununla hesaplanır)
 */

export async function GET(req: NextRequest) {
  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ ok: false, error: "yapılandırılmamış" }, { status: 503 });
  }

  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token") ?? "";
  const challenge = sp.get("hub.challenge");

  const tokenBuf = Buffer.from(token);
  const verifyBuf = Buffer.from(verifyToken);
  const tokenValid = tokenBuf.length === verifyBuf.length && timingSafeEqual(tokenBuf, verifyBuf);

  if (mode === "subscribe" && tokenValid && challenge) {
    // Meta düz metin olarak challenge'ın aynen yansıtılmasını bekler
    return new NextResponse(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return NextResponse.json({ ok: false, error: "verification_failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ ok: false, error: "yapılandırılmamış" }, { status: 503 });
  }

  // Gövde-boyutu sınırı imza/HMAC hesaplamasından ÖNCE kontrol edilir — kardeş
  // netgsm-sms ucuyla aynı desen (bkz. public-request-security.ts). Aksi halde
  // imzasız/rastgele büyük POST'lar tüm gövde belleğe alınıp HMAC'lenerek
  // CPU/bellek tüketimine yol açabilir.
  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  const bodyBytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bodyBytes === null) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  // İmza ham gövde üzerinden hesaplanır — json() öncesi ham bayt/metin kullanılır
  const rawBody = new TextDecoder().decode(bodyBytes);
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  const valid =
    headerBuf.length === expectedBuf.length && timingSafeEqual(headerBuf, expectedBuf);

  if (!valid) {
    console.warn("[meta-webhook] imza reddedildi");
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  type MetaChange = {
    field?: string;
    value?: {
      metadata?: { phone_number_id?: string };
      messages?: MetaInboundMessage[];
    };
  };
  let body: { object?: string; entry?: { id?: string; changes?: MetaChange[] }[] };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    console.log("[meta-webhook] alındı: JSON olmayan gövde,", rawBody.length, "bayt");
    return NextResponse.json({ ok: true });
  }

  let ingested = 0;
  let quarantined = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id ?? null;
      for (const message of change.value?.messages ?? []) {
        const result = await ingestMetaInboundMessage(message, phoneNumberId, change as unknown as Record<string, unknown>);
        if (result.quarantined) quarantined += 1;
        else if (result.ok) ingested += 1;
      }
    }
  }
  console.log("[meta-webhook] alındı:", { object: body.object ?? null, ingested, quarantined });

  return NextResponse.json({ ok: true });
}
