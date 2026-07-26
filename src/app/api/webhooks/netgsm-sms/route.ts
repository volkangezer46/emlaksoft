import { NextRequest, NextResponse } from "next/server";
import { ingestInboundSms } from "@/app/actions/communications";

/**
 * Netgsm gelen SMS webhook'u.
 *
 * Netgsm'in inbound SMS bildirim formatı hesaba/pakete göre değişebiliyor ve
 * resmi tek bir şema belgesine bağlanamadı; bu yüzden GENEL bir şema kabul
 * edilir: gönderen/alıcı/mesaj alanları birden çok olası adla okunur
 * (JSON gövde, form gövde veya query string).
 *
 * Güvenlik: URL'e `?secret=` (veya `x-webhook-secret` başlığı) ile
 * NETGSM_WEBHOOK_SECRET eklenmeli — Netgsm panelinde callback URL'i
 * `https://.../api/webhooks/netgsm-sms?secret=XYZ` olarak tanımlayın.
 *
 * Yanıt politikası: secret doğruysa HER ZAMAN 200 dönülür (işleme başarısız
 * olsa bile) — sağlayıcı tarafında retry fırtınası tetiklememek için. Sonuç
 * console'a loglanır; kayıp mesaj analizi bu loglardan yapılır.
 */

/** Alan adı adayları — ilk dolu değer kazanır. */
const FROM_KEYS = ["from", "gsmno", "gsm", "sender", "msisdn", "originator", "telno"];
const TO_KEYS = ["to", "receiver", "recipient", "number", "header", "msgheader", "shortcode"];
const MSG_KEYS = ["message", "msg", "text", "content", "body", "mesaj"];

function pick(source: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = source[key];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

/** JSON / form / query kaynaklarını tek düz string haritasında toplar. */
async function collectFields(req: NextRequest): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};

  // Query string (Netgsm bazı ürünlerde GET-benzeri parametre taşır)
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key !== "secret") fields[key.toLowerCase()] = value;
  });

  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as unknown;
      if (body && typeof body === "object") {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number") {
            fields[key.toLowerCase()] = String(value);
          }
        }
      }
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await req.formData();
      form.forEach((value, key) => {
        if (typeof value === "string") fields[key.toLowerCase()] = value;
      });
    } else {
      // Bilinmeyen içerik türü — ham gövdeyi querystring gibi çözmeyi dene
      const raw = await req.text();
      if (raw) {
        new URLSearchParams(raw).forEach((value, key) => {
          fields[key.toLowerCase()] = value;
        });
      }
    }
  } catch {
    // Gövde parse edilemedi — query'den toplananlarla devam
  }

  return fields;
}

export async function POST(req: NextRequest) {
  const secret = process.env.NETGSM_WEBHOOK_SECRET;
  if (!secret) {
    // Entegrasyon bilinçli olarak kapalı — sağlayıcıya "yapılandırılmamış" de
    return NextResponse.json({ ok: false, error: "yapılandırılmamış" }, { status: 503 });
  }

  const given =
    req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (given !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const fields = await collectFields(req);
  const from = pick(fields, FROM_KEYS);
  const to = pick(fields, TO_KEYS);
  const message = pick(fields, MSG_KEYS);

  if (!from || !message) {
    console.warn("[netgsm-webhook] tanınmayan payload — alanlar:", Object.keys(fields));
    // Yine 200: format sürprizi retry ile düzelmez, log yeterli
    return NextResponse.json({ ok: true, skipped: true, reason: "unrecognized_payload" });
  }

  try {
    const result = await ingestInboundSms({ secret, from, to, message });
    console.log("[netgsm-webhook] sonuç:", {
      ok: result.ok,
      skipped: result.skipped ?? false,
      reason: result.reason ?? null,
    });
    return NextResponse.json({ ok: true, skipped: result.skipped ?? false });
  } catch (err) {
    console.error("[netgsm-webhook] ingest hatası:", err instanceof Error ? err.message : err);
    // Hata olsa da 200 — retry fırtınası önleme (yukarıdaki yanıt politikası)
    return NextResponse.json({ ok: true, skipped: true, reason: "ingest_error" });
  }
}
