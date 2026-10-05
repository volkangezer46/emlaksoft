import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { getReportPdf } from "@/lib/ef-credits/service";

// Değerleme PDF'i: EmlakFiyati istemci zaman aşımı 90 sn'den az olamaz (sözleşme); Vercel işlev süresi buna göre geniş tutulur.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * GET /api/app/ef-rapor/[raporId]/pdf — kendi sunucumuz üzerinden PDF (kullanıcıya EmlakFiyati anahtarı/URL'si ASLA gitmez).
 * Kimlik: oturum çerezi; yetki: valuation/create (ilk indirme kontör düşer; tekrarlar ücretsiz). rapor_id bir ERİŞİM ANAHTARIDIR:
 * rapor BU ofise ait değilse 404. Yanıt önbelleğe ALINMAZ.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ raporId: string }> }) {
  const { raporId } = await params;

  const gate = await requirePermission("valuation", "create");
  if (!gate.ok) return jsonError(gate.error, gate.error === "Oturum bulunamadı." ? 401 : 403);

  const limit = await checkRateLimit(`ef-pdf:${gate.userId}`, { limit: 20, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!limit.allowed) return jsonError("Çok fazla PDF isteği. Lütfen birkaç dakika sonra tekrar deneyin.", 429, { "Retry-After": "300" });

  const res = await getReportPdf({ tenantId: gate.tenantId, userId: gate.userId, raporId });
  switch (res.status) {
    case "ok":
      return new Response(res.bytes as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${res.filename}"`,
          "Content-Length": String(res.bytes.byteLength),
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
          "X-EF-Units-Charged": String(res.unitsCharged),
        },
      });
    case "not_found":
    case "expired":
      return jsonError(res.message, 404);
    case "no_credit":
      return jsonError(`Yetersiz kontör: bu işlem ${res.needed} kontör, kalan ${res.available}.`, 402);
    case "busy":
      return jsonError(res.message, 409, { "Retry-After": "5" });
    case "disabled":
      return jsonError(res.message, 503);
    case "error":
      return jsonError(res.message, res.kind === "not_found" ? 404 : res.kind === "rate_limited" || res.kind === "unavailable" || res.kind === "too_many_local" ? 429 : 502);
  }
}
