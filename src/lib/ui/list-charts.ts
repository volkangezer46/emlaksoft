/**
 * Liste sayfası grafiklerinin SAF yardımcıları (ListPage `ColumnChartCard` / `DistributionCard`).
 *
 * Haftalık kova kuralı: liste filtreleri `from`/`to` tarihlerini UTC gün sınırıyla uygular
 * (`gte(created_at, 'YYYY-MM-DD')`, `lte(created_at, 'YYYY-MM-DDT23:59:59.999')`). Kovalar da AYNI
 * kuralla (bugünle biten 7 tam UTC günü) sayılır; böylece sütun sayısı = tıklanınca açılan listenin
 * sayısı (sıfır çıkmaz + sahte sayı yok). Tarama kesildiyse (`scanLimit`) seri güvenilmez → null.
 */

const DAY_MS = 86_400_000;

export type WeekBucket = { from: string; to: string; label: string; title: string; count: number };

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shortFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Bugünle (UTC) biten `weeks` adet 7 günlük kova; eskiden yeniye. */
export function weekBuckets(
  isos: ReadonlyArray<string | null | undefined>,
  nowMs: number,
  weeks = 8,
): WeekBucket[] {
  const todayStart = Date.parse(`${dayKey(nowMs)}T00:00:00.000Z`);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => {
    const endStart = todayStart - (weeks - 1 - i) * 7 * DAY_MS;
    const startMs = endStart - 6 * DAY_MS;
    const from = dayKey(startMs);
    const to = dayKey(endStart);
    const label = i === weeks - 1 ? "Bu hafta" : shortFmt.format(startMs);
    return { from, to, label, title: `${shortFmt.format(startMs)} – ${shortFmt.format(endStart)}`, count: 0 };
  });
  const first = buckets[0]?.from ?? "";
  for (const iso of isos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    const k = dayKey(t);
    if (k < first || k > (buckets[weeks - 1]?.to ?? "")) continue;
    const idx = Math.floor((Date.parse(`${k}T00:00:00.000Z`) - Date.parse(`${first}T00:00:00.000Z`)) / (7 * DAY_MS));
    if (idx >= 0 && idx < weeks) buckets[idx]!.count += 1;
  }
  return buckets;
}

/** Tarama kesilmediyse kovalar, kesildiyse null (grafik çizilmez). */
export function weekBucketsOf(
  isos: ReadonlyArray<string | null | undefined>,
  nowMs: number,
  scanLimit: number,
  weeks = 8,
): WeekBucket[] | null {
  if (isos.length >= scanLimit) return null;
  return weekBuckets(isos, nowMs, weeks);
}

/** Etiket → sayı haritası (null/boş anahtar `emptyKey` altında). */
export function countBy<T>(rows: readonly T[], key: (r: T) => string | null | undefined, emptyKey = ""): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || emptyKey;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** URL kurucu: mevcut parametrelere (sayfa hariç) ekleme/çıkarma yapar. */
export function withParams(pathname: string, base: Record<string, string | undefined>, over: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v && k !== "sayfa") usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
