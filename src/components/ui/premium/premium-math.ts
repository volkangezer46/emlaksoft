/**
 * Premium konsol bileşenlerinin saf mantığı (DOM/React/zaman yok; vitest kapsamında).
 * Sparkline yolu, mini çubuk geometrisi, trend hesabı, dönem ayrıştırma ve
 * erişilebilir seri özeti burada; bileşenler yalnız çizer.
 *
 * İlke: UYDURMA ÇİZİM YOK. Geçerli (sonlu) en az 2 nokta yoksa geometri `null`
 * döner ve bileşen hiçbir şey çizmez.
 */

export type PremiumTone = "brand" | "success" | "warn" | "danger" | "gold" | "neutral";

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

function cleanSeries(data: readonly number[] | undefined | null): number[] {
  return (data ?? []).filter((n) => Number.isFinite(n));
}

/** Çizilebilir seri mi? (en az 2 sonlu nokta) */
export function hasSeries(data: readonly number[] | undefined | null): boolean {
  return cleanSeries(data).length >= 2;
}

export type SparkPath = {
  /** Yumuşak çizgi için SVG `d` */
  line: string;
  /** Çizginin altını tabana kapatan alan `d` */
  area: string;
  last: { x: number; y: number };
  coords: { x: number; y: number }[];
  flat: boolean;
};

/**
 * Seriden yumuşak (yatay teğetli kübik) sparkline yolu. Yatay teğet, eğrinin
 * komşu noktaların aralığından taşmasını (aşma/overshoot) engeller; yani
 * çizim verinin gösterdiğinden fazlasını söylemez. Tüm değerler eşitse çizgi
 * dikey ortaya oturur (gerçek "değişmedi" durumu).
 */
export function sparkPath(
  data: readonly number[] | undefined | null,
  opts: { width?: number; height?: number; padding?: number } = {},
): SparkPath | null {
  const series = cleanSeries(data);
  if (series.length < 2) return null;
  const width = opts.width ?? 160;
  const height = opts.height ?? 40;
  const pad = opts.padding ?? 4;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  const flat = range === 0;
  const usable = Math.max(0, height - pad * 2);
  const coords = series.map((v, i) => ({
    x: r2((i / (series.length - 1)) * width),
    y: r2(flat ? height / 2 : height - pad - ((v - min) / range) * usable),
  }));
  let line = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const mx = r2((a.x + b.x) / 2);
    line += ` C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
  }
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, last: coords[coords.length - 1], coords, flat };
}

export type Bar = { x: number; y: number; w: number; h: number; last: boolean };

/**
 * Mini çubuk geometrisi. Sıfır değer 1.5 birimlik taban çizgisi alır (boş
 * görünmesin ama yükseklik de uydurulmasın). Hepsi sıfırsa yine tabana çizilir.
 */
export function barsGeometry(
  data: readonly number[] | undefined | null,
  opts: { width?: number; height?: number; gap?: number } = {},
): Bar[] | null {
  const series = cleanSeries(data);
  if (series.length < 2) return null;
  const width = opts.width ?? 64;
  const height = opts.height ?? 32;
  const gap = opts.gap ?? 3;
  const n = series.length;
  const w = Math.max(1, (width - gap * (n - 1)) / n);
  const max = Math.max(...series, 0);
  return series.map((v, i) => {
    const h = max <= 0 || v <= 0 ? 1.5 : Math.max(2, (v / max) * height);
    return { x: r2(i * (w + gap)), y: r2(height - h), w: r2(w), h: r2(h), last: i === n - 1 };
  });
}

export type Trend = {
  dir: "up" | "down" | "flat" | "new";
  /** Gösterilecek metin: "%12", "yeni", "%0" (yön oktan okunur) */
  label: string;
  /** Mutlak yüzde (yeni/düz için null) */
  pct: number | null;
  /** Değişim iyi mi? (invert: kayıp gibi artışı kötü metrikler). Düz/yeni için null. */
  good: boolean | null;
  /** Ekran okuyucu cümlesi */
  sr: string;
};

/**
 * Önceki döneme göre trend. Önceki 0 iken oran tanımsızdır: sahte yüzde yerine
 * "yeni" (cari > 0) ya da "%0" (ikisi de 0) döner.
 */
export function computeTrend(current: number, previous: number, invert = false): Trend {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { dir: "flat", label: "—", pct: null, good: null, sr: "Karşılaştırma yok" };
  }
  if (previous <= 0) {
    return current > 0
      ? { dir: "new", label: "yeni", pct: null, good: null, sr: "Önceki dönemde kayıt yoktu, yeni" }
      : { dir: "flat", label: "%0", pct: 0, good: null, sr: "Önceki döneme göre değişmedi" };
  }
  const raw = Math.round(((current - previous) / previous) * 100);
  if (raw === 0) return { dir: "flat", label: "%0", pct: 0, good: null, sr: "Önceki döneme göre değişmedi" };
  const up = raw > 0;
  const abs = Math.abs(raw);
  return {
    dir: up ? "up" : "down",
    label: abs > 999 ? "%999+" : `%${abs}`,
    pct: abs,
    good: invert ? !up : up,
    sr: `Önceki döneme göre %${abs} ${up ? "artış" : "azalış"}`,
  };
}

/** Dönem seçici: yalnız 7 / 30 / 90 gün. */
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;
export const PERIOD_PARAM = "donem";

export function parsePeriod(raw: string | string[] | undefined | null, fallback: Period = DEFAULT_PERIOD): Period {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? "", 10);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : fallback;
}

/** Dönem seçicinin bağlantısı: diğer sorgu parametreleri korunur, varsayılan dönemde param düşer. */
export function periodHref(
  basePath: string,
  params: Record<string, string | undefined>,
  value: Period,
  fallback: Period = DEFAULT_PERIOD,
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== PERIOD_PARAM) usp.set(k, v);
  if (value !== fallback) usp.set(PERIOD_PARAM, String(value));
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Tarih listesini, `nowMs` ile biten `days` günlük pencerede `count` eşit kovaya böler
 * (en eski → en yeni). Pencere dışı tarihler ve geçersiz değerler atlanır.
 */
export function bucketDates(dates: readonly string[], nowMs: number, days: number, count: number): number[] {
  const buckets = Array.from({ length: count }, () => 0);
  const span = days * 86_400_000;
  const size = span / count;
  for (const iso of dates) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    const age = nowMs - t;
    if (age < 0 || age >= span) continue;
    buckets[count - 1 - Math.floor(age / size)] += 1;
  }
  return buckets;
}

/** Dönem için kova sayısı (7 gün → 7, 30 gün → 10, 90 gün → 9). */
export function bucketCountFor(period: Period): number {
  return period === 7 ? 7 : period === 30 ? 10 : 9;
}

/** role=img için kısa özet: "Son 7 nokta: en düşük 0, en yüksek 5, son 3". */
export function summarizeSeries(data: readonly number[] | undefined | null, unit = "nokta"): string {
  const s = cleanSeries(data);
  if (s.length === 0) return "Veri yok";
  const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
  return `Son ${s.length} ${unit}: en düşük ${nf.format(Math.min(...s))}, en yüksek ${nf.format(Math.max(...s))}, son ${nf.format(s[s.length - 1])}`;
}
