import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { applyMessageLogStatus } from "@/lib/messaging/message-log";
import { netgsmReportFieldSets, parseNetgsmReport } from "@/lib/webhooks/netgsm-report";
import {
  PUBLIC_REQUEST_MAX_BYTES,
  readRequestBodyLimited,
  requestBodyTooLarge,
} from "@/lib/public-request-security";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function secretMatches(actual: string, expected: string): boolean {
  const a = createHash("sha256").update(actual, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Sorgu dizesi + gövde (JSON / form) → rapor alan kümeleri. Desteklenmeyen içerik türü fırlatır. */
async function collectReports(req: NextRequest): Promise<Record<string, string>[] | null> {
  const query: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    if (key.toLowerCase() !== "secret") query[key.toLowerCase()] = value;
  });
  const bytes = await readRequestBodyLimited(req, PUBLIC_REQUEST_MAX_BYTES);
  if (bytes === null) return null;
  if (bytes.byteLength === 0) return [query];
  const text = new TextDecoder().decode(bytes);
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) return netgsmReportFieldSets(JSON.parse(text) as unknown);
  if (contentType.includes("application/x-www-form-urlencoded") || !contentType || contentType.startsWith("text/plain")) {
    const fields = { ...query };
    new URLSearchParams(text).forEach((value, key) => {
      fields[key.toLowerCase()] = value;
    });
    return [fields];
  }
  throw new Error("unsupported_content_type");
}

/**
 * Netgsm SMS iletim raporu bildirimi (SN3). Netgsm panelinde rapor adresi:
 * `https://emlaksoft.com.tr/api/webhooks/netgsm-rapor?secret=<NETGSM_WEBHOOK_SECRET>` (ya da `x-webhook-secret` başlığı).
 * Paylaşılan gizli anahtar sabit zamanlı karşılaştırılır; yanlış/eksikse 401 ve hiçbir satır değişmez. Rapor, gönderim
 * günlüğündeki (`message_sends`) satırı Netgsm iş kimliğiyle bulur ve durumu öncelik kuralıyla ilerletir (teslim edildi /
 * başarısız). Raporda numara varsa günlükteki alıcı özetiyle eşleşmek zorundadır. İşlem idempotenttir; günlükte
 * bulunmayan iş (ör. günlükten önceki gönderim) 200 ile yok sayılır (Netgsm boşuna yeniden denemez).
 */
export async function POST(req: NextRequest) {
  const expected = process.env.NETGSM_WEBHOOK_SECRET?.trim();
  if (!expected) return json({ ok: false, error: "not_configured" }, 503);
  const actual = req.headers.get("x-webhook-secret")?.trim() ?? req.nextUrl.searchParams.get("secret")?.trim() ?? "";
  if (!secretMatches(actual, expected)) return json({ ok: false, error: "unauthorized" }, 401);
  if (requestBodyTooLarge(req.headers, PUBLIC_REQUEST_MAX_BYTES)) return json({ ok: false, error: "payload_too_large" }, 413);

  let sets: Record<string, string>[] | null;
  try {
    sets = await collectReports(req);
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  if (sets === null) return json({ ok: false, error: "payload_too_large" }, 413);

  let applied = 0;
  let ignored = 0;
  let failed = 0;
  for (const fields of sets) {
    const report = parseNetgsmReport(fields);
    if (!report) {
      ignored += 1;
      continue;
    }
    try {
      const r = await applyMessageLogStatus({
        channel: "sms",
        providerId: report.jobId,
        status: report.status,
        occurredAt: report.occurredAt,
        errorCode: report.code,
        error: report.error,
        to: report.phone,
        segments: report.segments,
      });
      if (r === "applied") applied += 1;
      else ignored += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error("[netgsm-rapor] processing failed", { failed, applied });
    return json({ ok: false, error: "processing_failed" }, 503);
  }
  return json({ ok: true, applied, ignored });
}

/** Netgsm bazı hesaplarda raporu GET sorgu dizesiyle iletir; aynı doğrulama ve işleme. */
export async function GET(req: NextRequest) {
  return POST(req);
}
