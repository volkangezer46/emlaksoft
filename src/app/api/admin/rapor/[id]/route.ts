import { NextResponse } from "next/server";
import { getPlatformStaff } from "@/lib/platform";
import { handleReportDownload } from "@/lib/report-center/download";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/rapor/[id]?format=xlsx|pdf|csv&<filtreler> — platform raporu indirme.
 * Yalnız EmlakSoft personeli: kısıtlı kapı (parolası değişmemiş / MFA'sız personel reddedilir), ardından `reports`
 * departman modülü + raporun kendi modülü (örn. billing, tenants) `handleReportDownload` içinde denetlenir.
 * İndirme `platform_audit_logs`'a yazılır.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await getPlatformStaff();
  if (!staff) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  return handleReportDownload("platform", id, req);
}
