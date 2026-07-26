import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Meta (WhatsApp Business / Messenger) webhook iskeleti.
 *
 * GET  → Meta'nın webhook doğrulama el sıkışması (hub.challenge yansıtma).
 * POST → X-Hub-Signature-256 imza kontrolü + gövde özeti log; işleme henüz YOK.
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
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
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

  // İmza ham gövde üzerinden hesaplanır — json() öncesi text() ile oku
  const rawBody = await req.text();
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

  // Gövde özeti — hata logu DEĞİL, gözlem amaçlı console kaydı:
  // hangi obje/alan geldiğini görmek entegrasyonu bağlarken yol gösterir.
  try {
    const body = JSON.parse(rawBody) as {
      object?: string;
      entry?: { id?: string; changes?: { field?: string }[] }[];
    };
    console.log("[meta-webhook] alındı:", {
      object: body.object ?? null,
      entries: body.entry?.length ?? 0,
      fields: (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.field ?? "?")),
    });
  } catch {
    console.log("[meta-webhook] alındı: JSON olmayan gövde,", rawBody.length, "bayt");
  }

  // STUB: WhatsApp Business hesabı bağlanınca ingest buraya —
  // entry[].changes[].value.messages[] içinden from/text okunup, Netgsm SMS
  // akışındaki gibi ingestInboundWhatsapp(...) benzeri bir service-role
  // fonksiyonuyla communications tablosuna (channel: 'whatsapp',
  // direction: 'inbound') yazılacak. Tenant eşlemesi burada daha net olacak:
  // entry[].id (WABA/phone_number_id) → tenant_integrations(provider:'whatsapp')
  // kaydındaki credentials ile birebir eşlenebilir.

  return NextResponse.json({ ok: true });
}
