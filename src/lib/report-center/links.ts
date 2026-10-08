/**
 * Rapor merkezi bağlantıları (SAF — katalog içe aktarmaz). Sayfa içindeki "Raporlarda aç" bağlantıları ve rapor
 * merkezi arayüzü aynı adresi üretir; liste filtreleri sorgu parametresi olarak rapora taşınır.
 */
import type { ReportScope } from "./types";

export const REPORT_CENTER_PATH: Record<ReportScope, string> = { tenant: "/app/raporlar", platform: "/admin/raporlar" };
export const REPORT_API_PATH: Record<ReportScope, string> = { tenant: "/api/app/rapor", platform: "/api/admin/rapor" };

type Params = Record<string, string | undefined | null>;

function query(params: Params): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && String(v).trim() !== "") sp.set(k, String(v));
  return sp.toString();
}

/** Rapor merkezinde belirli raporu (önceden filtreli) açan adres. */
export function reportCenterHref(scope: ReportScope, reportId: string, filters: Params = {}): string {
  return `${REPORT_CENTER_PATH[scope]}?${query({ sekme: "merkez", rapor: reportId, ...filters })}`;
}

/** Dosya indirme adresi (GET route handler). */
export function reportDownloadHref(scope: ReportScope, reportId: string, format: string, filters: Params = {}): string {
  return `${REPORT_API_PATH[scope]}/${encodeURIComponent(reportId)}?${query({ format, ...filters })}`;
}
