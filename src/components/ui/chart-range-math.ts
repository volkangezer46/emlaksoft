/**
 * Grafik zaman aralığı matematiği — SAF (React/Recharts yok; birim testli).
 * Aralık, veri dizisinde KAPSAYICI [başlangıç, bitiş] indeksidir. Tüm hesap istemcide, sunucudan gelen
 * geniş veri üzerinde yapılır (sahte veri üretilmez; veri yoksa özet de yoktur).
 */
export type Range = readonly [number, number];
export type Granularity = "day" | "week" | "month";
export type RangePreset = { key: string; label: string; count: number | null };
export type RangeSummaryMode = "total" | "last" | "none";

export const MIN_SPAN = 2;

/** Aralığı [0, n-1] içine sıkıştırır; en az `minSpan` nokta, sıra bozulmaz. */
export function clampRange(range: Range, n: number, minSpan = MIN_SPAN): Range {
  if (n <= 0) return [0, 0];
  const span = Math.min(minSpan, n);
  let a = Math.round(Math.min(range[0], range[1]));
  let b = Math.round(Math.max(range[0], range[1]));
  a = Math.max(0, Math.min(a, n - span));
  b = Math.min(n - 1, Math.max(b, a + span - 1));
  return [a, b];
}

export function fullRange(n: number): Range {
  return [0, Math.max(0, n - 1)];
}

export function isFullRange(range: Range, n: number): boolean {
  return range[0] <= 0 && range[1] >= n - 1;
}

/** Veri ne kadarsa o kadar hazır aralık: yalnız mevcut veriden KISA olanlar + "Tümü". */
export function presetsFor(available: number, granularity: Granularity = "month"): RangePreset[] {
  const defs: Array<{ key: string; label: string; count: number }> =
    granularity === "day"
      ? [
          { key: "7g", label: "7G", count: 7 },
          { key: "30g", label: "30G", count: 30 },
          { key: "3a", label: "3A", count: 90 },
          { key: "6a", label: "6A", count: 180 },
          { key: "1y", label: "1Y", count: 365 },
        ]
      : granularity === "week"
        ? [
            { key: "4h", label: "4H", count: 4 },
            { key: "3a", label: "3A", count: 13 },
            { key: "6a", label: "6A", count: 26 },
            { key: "1y", label: "1Y", count: 52 },
          ]
        : [
            { key: "3a", label: "3A", count: 3 },
            { key: "6a", label: "6A", count: 6 },
            { key: "1y", label: "1Y", count: 12 },
          ];
  const out: RangePreset[] = defs.filter((d) => d.count < available && d.count >= MIN_SPAN);
  return [...out, { key: "all", label: "Tümü", count: null }];
}

/** Hazır aralık: son `count` gerçek nokta (anchor = son gerçek nokta indeksi), tahmin kuyruğu dahil. */
export function rangeForPreset(n: number, count: number | null, anchor = n - 1): Range {
  if (count === null) return fullRange(n);
  return clampRange([anchor - count + 1, n - 1], n);
}

/** Sol/sağ kenarı sürükle (indeks bazlı); karşı kenarı geçemez. */
export function dragEdge(range: Range, edge: "start" | "end", index: number, n: number): Range {
  return edge === "start"
    ? clampRange([Math.min(index, range[1] - MIN_SPAN + 1), range[1]], n)
    : clampRange([range[0], Math.max(index, range[0] + MIN_SPAN - 1)], n);
}

/** Pencereyi genişliğini koruyarak kaydır (başlangıç indeksi hedef). */
export function moveWindow(range: Range, start: number, n: number): Range {
  const span = range[1] - range[0];
  const a = Math.max(0, Math.min(Math.round(start), n - 1 - span));
  return [a, a + span];
}

/** Yüzde değişim; taban 0/boşsa null (uydurma oran yok). */
export function changePct(current: number, base: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

export type RangeSummary = {
  main: number | null;
  /** Değişim (%) ve neye göre olduğu. */
  change: { pct: number; basis: "previous" | "start" } | null;
};

function numeric(values: ReadonlyArray<number | null | undefined>, a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Seçili aralığın özeti. "total": aralık toplamı, değişim = önceki AYNI UZUNLUKTAKİ pencereye göre
 * (pencere veriye sığmıyorsa değişim yok — uydurma taban yok). "last": aralıktaki son değer,
 * değişim = aralığın ilk değerine göre.
 */
export function summarizeRange(values: ReadonlyArray<number | null | undefined>, range: Range, mode: RangeSummaryMode): RangeSummary {
  if (mode === "none") return { main: null, change: null };
  const inRange = numeric(values, range[0], range[1]);
  if (inRange.length === 0) return { main: null, change: null };
  if (mode === "last") {
    const first = inRange[0]!;
    const last = inRange[inRange.length - 1]!;
    const pct = inRange.length >= 2 ? changePct(last, first) : null;
    return { main: last, change: pct === null ? null : { pct, basis: "start" } };
  }
  const total = inRange.reduce((s, v) => s + v, 0);
  const span = range[1] - range[0] + 1;
  const pa = range[0] - span;
  if (pa < 0) return { main: total, change: null };
  const prev = numeric(values, pa, range[0] - 1);
  if (prev.length === 0) return { main: total, change: null };
  const pct = changePct(total, prev.reduce((s, v) => s + v, 0));
  return { main: total, change: pct === null ? null : { pct, basis: "previous" } };
}

/** İmleç konumu (0..1) → nokta indeksi. */
export function indexAtFraction(fraction: number, n: number): number {
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(fraction * (n - 1))));
}
