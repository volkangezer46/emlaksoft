import { handleReportDownload } from "@/lib/report-center/download";

// Rapor üretimi sayfa sayfa okur ve dosyayı bellekte kurar; en fazla ~45 sn sürer.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/app/rapor/[id]?format=xlsx|pdf|csv&<filtreler> — ofis raporu indirme.
 * Kimlik: oturum çerezi (proxy /api'yi kapsamaz; kapı `handleReportDownload` içinde: `reports` + raporun modülü).
 * Veri RLS'li kullanıcı istemcisiyle okunur; kapsam kuralı rapor tanımındadır.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleReportDownload("tenant", id, req);
}
