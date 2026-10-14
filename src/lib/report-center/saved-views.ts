/**
 * Kayıtlı rapor görünümü — SAF kurallar (DG4). Görünüm = rapor + filtre seti. Kaydederken ve açarken filtreler AYNI
 * doğrulayıcıdan (`parseFilters`) geçer: kayıtlı görünüm açıldığında URL'deki filtreler kayıttakiyle birebir aynıdır.
 * Kaydederken doğrulama BÜTÜNDÜR (geçersiz değer hata verir). Okurken ANAHTAR ANAHTAR doğrulanır: tanımdan kalkmış ya
 * da geçersizleşmiş anahtar atılır, geçerli olanlar KORUNUR (rapor hata vermez, filtresiz açılmaz). Zamanlanmış teslim
 * atılan anahtar varsa göndermez (`readViewFilters().dropped`; filtresiz tam rapor sessizce gitmesin).
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

/**
 * Okurken: her anahtar AYRI doğrulanır; geçersiz/kalkmış anahtar `dropped`'a yazılır, geçerli olanlar korunur.
 * Başlangıç bitişten sonraysa iki tarih de atılır.
 */
export function readViewFilters(def: Pick<ReportDef, "filters">, raw: unknown): { filters: Filters; dropped: string[] } {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const known = new Set(def.filters.map((f) => f.key));
  const filters: Filters = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) continue;
    if (!known.has(k) || typeof v !== "string") {
      dropped.push(k);
      continue;
    }
    const one = parseFilters(def, { [k]: v });
    const value = one.ok ? one.filters[k] : undefined;
    if (value) filters[k] = value;
    else dropped.push(k);
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    delete filters.from;
    delete filters.to;
    dropped.push("from", "to");
  }
  return { filters, dropped };
}

/** Okurken: geçersiz anahtarlar atılır, geçerli olanlar korunur (kayıtlı görünüm her zaman açılabilir). */
export function storedViewFilters(def: Pick<ReportDef, "filters">, raw: unknown): Filters {
  return readViewFilters(def, raw).filters;
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
