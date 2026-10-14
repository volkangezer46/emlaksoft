/**
 * Kayıtlı rapor görünümü — SAF kurallar (DG4). Görünüm = rapor + filtre seti. Kaydederken ve açarken filtreler AYNI
 * doğrulayıcıdan (`parseFilters`) geçer: kayıtlı görünüm açıldığında URL'deki filtreler kayıttakiyle birebir aynıdır;
 * tanımdan kalkmış ya da geçersizleşmiş anahtar sessizce atılır (rapor hata vermez).
 */
import { parseFilters, type ParsedFilters } from "./filters";
import { reportCenterHref } from "./links";
import type { Filters, ReportDef, ReportScope } from "./types";

export const VIEW_NAME_MAX = 60;
/** Kişi başına rapor başına en çok görünüm. */
export const VIEWS_PER_REPORT_MAX = 30;

/** DB'deki jsonb (ya da form) değerini rapor tanımına göre süzer ve doğrular. */
export function cleanViewFilters(def: Pick<ReportDef, "filters">, raw: unknown): ParsedFilters {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strings: Record<string, string> = {};
  for (const f of def.filters) {
    const v = source[f.key];
    if (typeof v === "string" && v.trim() !== "") strings[f.key] = v;
  }
  const parsed = parseFilters(def, strings);
  if (!parsed.ok) return parsed;
  const out: Filters = {};
  for (const [k, v] of Object.entries(parsed.filters)) if (v) out[k] = v;
  return { ok: true, filters: out };
}

/** Okurken: geçersiz kayıt boş filtreye düşer (kayıtlı görünüm her zaman açılabilir). */
export function storedViewFilters(def: Pick<ReportDef, "filters">, raw: unknown): Filters {
  const parsed = cleanViewFilters(def, raw);
  return parsed.ok ? parsed.filters : {};
}

/** Görünümü açan rapor merkezi adresi (filtreler URL'de). */
export function savedViewHref(scope: ReportScope, reportId: string, filters: Filters): string {
  return reportCenterHref(scope, reportId, filters);
}

/** Geçerli filtreler kayıtlı görünümle aynı mı (aktif görünüm vurgusu). */
export function sameFilters(a: Filters, b: Filters): boolean {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}
