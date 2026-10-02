/**
 * Filtre çubuğu için saf URL parametre mantığı (sunucu ve istemcide güvenle çalışır).
 * Kontrat: boş/undefined değer paramı siler; filtre değişince `page` sıfırlanır.
 */
export type ParamValue = string | string[] | undefined | null;
export type ParamRecord = Record<string, ParamValue>;

const PAGE_PARAM = "page";

/** Next searchParams kaydını URLSearchParams'a çevirir (boşları atar). */
export function toSearchParams(record: ParamRecord): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const v of value) if (v !== "") sp.append(key, v);
    } else if (value !== undefined && value !== null && value !== "") {
      sp.set(key, value);
    }
  }
  return sp;
}

/**
 * Mevcut parametrelere `patch` uygular. Değeri ""/null/undefined olan anahtar silinir.
 * `resetPage` (varsayılan true) iken sayfalama başa döner.
 */
export function mergeParams(
  current: ParamRecord,
  patch: ParamRecord,
  options: { resetPage?: boolean } = {},
): URLSearchParams {
  const next: ParamRecord = { ...current, ...patch };
  if (options.resetPage !== false && !(PAGE_PARAM in patch)) delete next[PAGE_PARAM];
  return toSearchParams(next);
}

/** pathname + (varsa) ?query. */
export function buildHref(pathname: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Verilen anahtarlardan değeri dolu olanların sayısı (panel rozeti için). */
export function countActiveFilters(current: ParamRecord, keys: readonly string[]): number {
  let n = 0;
  for (const key of keys) {
    const v = current[key];
    if (Array.isArray(v) ? v.some((x) => x !== "") : v !== undefined && v !== null && v !== "") n++;
  }
  return n;
}

/** tr-TR sayı biçimi: 1.234. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("tr-TR").format(n);
}

/** Tarih aralığı doğrulaması (YYYY-MM-DD karşılaştırması leksikografik güvenlidir). */
export function isRangeInvalid(from?: string, to?: string): boolean {
  return Boolean(from && to && from > to);
}
