/**
 * Liste kiti — saf mantık (sunucu/istemci güvenli, zaman yardımcısı dışarıdan verilir).
 * Sahte veri yok: seri/trend yalnız gerçek kayıt tarihlerinden hesaplanır;
 * hesaplanamıyorsa null döner ve arayüz sade kalır.
 */
import { buildHref, mergeParams, toSearchParams, type ParamRecord } from "@/lib/ui/filter-params";

export const WEEK_MS = 7 * 86_400_000;

/** mergeParams + bu sayfalardaki `sayfa` sayfalama paramını da sıfırlar (filtre değişince 1. sayfa). */
export function mergeResetPage(params: ParamRecord, patch: ParamRecord): URLSearchParams {
  const sp = mergeParams(params, patch);
  sp.delete("sayfa");
  return sp;
}

/**
 * Tarihleri son `weeks` haftaya paketler. Dönen dizi eskiden yeniye sıralıdır;
 * son eleman "şimdi"yi içeren haftadır. Pencere dışı/geçersiz/gelecek tarihler atlanır.
 */
export function bucketByWeek(isos: ReadonlyArray<string | null | undefined>, nowMs: number, weeks = 8): number[] {
  const buckets = Array.from({ length: weeks }, () => 0);
  for (const iso of isos) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t > nowMs) continue;
    const idx = weeks - 1 - Math.floor((nowMs - t) / WEEK_MS);
    if (idx >= 0 && idx < weeks) buckets[idx] += 1;
  }
  return buckets;
}

/**
 * Tarama tabanlı haftalık seri: tarama `scanLimit`e dayandıysa (kesilmiş olabilir) seri
 * GÜVENİLİR DEĞİLDİR → undefined (çubuk/trend çizilmez, yaklaşık sayı uydurulmaz).
 */
export function weeklySeriesOf(
  isos: ReadonlyArray<string | null | undefined>,
  nowMs: number,
  scanLimit: number,
  weeks = 8,
): number[] | undefined {
  if (isos.length >= scanLimit) return undefined;
  return bucketByWeek(isos, nowMs, weeks);
}

export type Trend = {
  dir: "up" | "down" | "flat";
  /** Yüzde değişim; önceki dönem 0 ise hesaplanamaz (null). */
  pct: number | null;
  label: string;
};

/**
 * Serinin ikinci yarısını ilk yarısıyla karşılaştırır (ör. son 4 hafta / önceki 4 hafta).
 * İki yarı da 0 ise veya seri tek elemanlıysa null — "trend yok" gerçeği uydurulmaz.
 */
export function trendOf(series: readonly number[]): Trend | null {
  if (series.length < 2) return null;
  const half = Math.floor(series.length / 2);
  const prev = series.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = series.slice(series.length - half).reduce((a, b) => a + b, 0);
  if (prev === 0 && recent === 0) return null;
  if (prev === 0) return { dir: "up", pct: null, label: "yeni" };
  const pct = Math.round(((recent - prev) / prev) * 100);
  if (pct === 0) return { dir: "flat", pct: 0, label: "%0" };
  return { dir: pct > 0 ? "up" : "down", pct, label: `%${Math.abs(pct)}` };
}

/** Mini çubuklar çizilsin mi: en az bir sıfırdan büyük değer. */
export function hasSeries(series: readonly number[] | undefined): series is readonly number[] {
  return Boolean(series && series.length >= 2 && series.some((v) => v > 0));
}

/** Çubuk yükseklikleri (0–100 %, sıfır olmayan değer için en az 12 %). */
export function barHeights(series: readonly number[]): number[] {
  const max = Math.max(...series, 1);
  return series.map((v) => (v <= 0 ? 0 : Math.max(12, Math.round((v / max) * 100))));
}

export type CategoryOption = { value: string; label: string };
export type CategoryChipModel = {
  value: string;
  label: string;
  /** Yalnız gerçek ve güvenilir sayım varsa; aksi halde undefined (sayı gösterilmez). */
  count?: number;
  href: string;
  active: boolean;
};

/**
 * Sayaçlı kategori çipleri: "Tümü" + seçenekler. Sayacı 0 olan seçenek, aktif değilse
 * gizlenir (ölü çip yok). `counts === null` → sayımlar güvenilir değil, çipler sayısız çıkar.
 * Tanımda olmayan ama sayımda geçen değerler ("Diğer" sızıntısı) sonuna ham etiketle eklenir.
 */
export function buildCategoryChips(args: {
  options: readonly CategoryOption[];
  counts: Readonly<Record<string, number>> | null;
  total: number | null;
  active: string;
  pathname: string;
  params: ParamRecord;
  paramName?: string;
  /** "Tümü" çipinin etiketi (varsayılan görünüm "Tümü" değilse, ör. "Açık talepler"). */
  allLabel?: string;
}): CategoryChipModel[] {
  const { options, counts, total, active, pathname, params } = args;
  const paramName = args.paramName ?? "kategori";
  const hrefFor = (value: string) => buildHref(pathname, mergeResetPage(params, { [paramName]: value }));
  const known = new Set(options.map((o) => o.value));
  const all: CategoryOption[] = [...options];
  if (counts) {
    for (const key of Object.keys(counts)) {
      if (!known.has(key) && counts[key]! > 0) all.push({ value: key, label: key });
    }
  }
  const chips: CategoryChipModel[] = [
    { value: "", label: args.allLabel ?? "Tümü", count: total ?? undefined, href: hrefFor(""), active: !active },
  ];
  for (const opt of all) {
    const count = counts ? (counts[opt.value] ?? 0) : undefined;
    const isActive = opt.value === active;
    if (counts && count === 0 && !isActive) continue;
    chips.push({ value: opt.value, label: opt.label, count, href: hrefFor(opt.value), active: isActive });
  }
  return chips;
}

export type ActiveChipDef = {
  /** URL paramı. */
  key: string;
  /** Çipte gösterilecek önek ("Durum"). */
  label: string;
  /** Ham değeri okunur metne çevirir (yoksa ham değer). */
  format?: (value: string) => string;
};
export type ActiveChip = { key: string; text: string; clearHref: string };

/** Aktif filtreleri tek tek kaldırılabilir çiplere çevirir; kaldırma sayfalamayı sıfırlar. */
export function buildActiveChips(pathname: string, params: ParamRecord, defs: readonly ActiveChipDef[]): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const def of defs) {
    const raw = params[def.key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    const shown = def.format ? def.format(value) : value;
    chips.push({
      key: def.key,
      text: `${def.label}: ${shown}`,
      clearHref: buildHref(pathname, mergeResetPage(params, { [def.key]: "" })),
    });
  }
  return chips;
}

/** Yoğunluk paramı: yalnız "kompakt" bilinir; varsayılan "rahat". */
export type Density = "rahat" | "kompakt";
export function densityOf(value: string | null | undefined): Density {
  return value === "kompakt" ? "kompakt" : "rahat";
}

/** Sunucu formundan taşınacak gizli alanlar: kendi alanları ve sayfalama dışındaki parametreler. */
export function hiddenFields(params: ParamRecord, ownKeys: readonly string[], pageKeys: readonly string[] = ["page", "sayfa"]): Array<readonly [string, string]> {
  const skip = new Set([...ownKeys, ...pageKeys]);
  const out: Array<readonly [string, string]> = [];
  for (const [key, raw] of Object.entries(toSearchParamsRecord(params))) {
    if (skip.has(key)) continue;
    out.push([key, raw]);
  }
  return out;
}

const UUID_PARAM_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Doğrulanmış uuid paramı (ör. `?danisman=<profil id>`): geçersiz/boş değer "" döner,
 * böylece bozuk param sorguya sızıp listeyi sessizce boşaltmaz.
 */
export function uuidParam(value: string | string[] | null | undefined): string {
  const v = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return UUID_PARAM_RE.test(v) ? v : "";
}

/** Yalnız YYYY-MM-DD kabul edilir; aksi halde "". */
export function isoDateParam(value: string | string[] | null | undefined): string {
  const v = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/** `?sayfa=` değerini >= 1 tam sayıya çevirir. */
export function parsePage(value: string | string[] | null | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  return Math.max(1, Number.parseInt(v ?? "", 10) || 1);
}

export type PageWindow = {
  page: number;
  totalPages: number;
  offset: number;
  rangeStart: number;
  rangeEnd: number;
  hasPrev: boolean;
  hasNext: boolean;
};

/** Gerçek sayfalama penceresi: toplam, sayfa boyutu ve o sayfadaki satır sayısından. */
export function pageWindow(page: number, total: number, pageSize: number, rowsOnPage: number): PageWindow {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    offset,
    rangeStart: total === 0 ? 0 : offset + 1,
    rangeEnd: Math.min(offset + rowsOnPage, total),
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/** Sayfa linki: mevcut filtreler korunur, yalnız `sayfa` değişir (1. sayfada param yok). */
export function pageHrefOf(pathname: string, params: ParamRecord, n: number): string {
  const sp = toSearchParams(params);
  sp.delete("sayfa");
  if (n > 1) sp.set("sayfa", String(n));
  return buildHref(pathname, sp);
}

function toSearchParamsRecord(params: ParamRecord): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const [k, v] of toSearchParams(params).entries()) rec[k] = v;
  return rec;
}
