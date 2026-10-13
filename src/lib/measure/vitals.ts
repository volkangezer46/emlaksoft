/**
 * Gerçek kullanıcı hız ölçümü (SAF): değer → histogram kovası, histogram → p75 ve "iyi" oranı, Türkçe tek cümle.
 *
 * Ham değer SAKLANMAZ; `web_vitals_daily` yalnız (gün, şablon yol, cihaz, metrik, kova, statik mi) başına sayaç tutar.
 * Google eşikleri (iyi / geliştirilmeli / kötü) kova sınırlarında birebir yer alır; böylece "iyi" oranı tam hesaplanır.
 * p75 kova içinde doğrusal ara değerle bulunur (son kova açık uçludur: alt sınırı döner, `open:true`).
 */

export const METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type Metric = (typeof METRICS)[number];

export function isMetric(v: unknown): v is Metric {
  return typeof v === "string" && (METRICS as readonly string[]).includes(v);
}

/** Kova üst sınırları (dahil). Değer son sınırı aşarsa açık uçlu son kova (index = EDGES.length). */
export const EDGES: Record<Metric, readonly number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 8000, 10000, 15000, 20000],
  INP: [50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000],
  CLS: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 2],
  FCP: [300, 600, 900, 1200, 1500, 1800, 2100, 2400, 3000, 4000, 5000, 7000, 10000],
  TTFB: [100, 200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 1800, 2500, 4000, 6000],
};

/** Google eşikleri: değer ≤ good → iyi; ≤ poor → geliştirilmeli; üstü → kötü. */
export const THRESHOLDS: Record<Metric, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

/** Ölçüm makul aralıkta mı? (bozuk/uydurma değer sayılmaz) */
export function plausible(metric: Metric, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return metric === "CLS" ? value <= 50 : value <= 120_000;
}

/** Değerin kova indeksi (0..EDGES.length); geçersiz değer null. */
export function bucketOf(metric: Metric, value: number): number | null {
  if (!plausible(metric, value)) return null;
  const edges = EDGES[metric];
  for (let i = 0; i < edges.length; i++) if (value <= edges[i]!) return i;
  return edges.length;
}

export type Histogram = ReadonlyMap<number, number> | readonly { bucket: number; n: number }[];

function entries(h: Histogram): [number, number][] {
  const list: [number, number][] = Array.isArray(h)
    ? (h as readonly { bucket: number; n: number }[]).map((r) => [r.bucket, r.n])
    : [...(h as ReadonlyMap<number, number>).entries()];
  const merged = new Map<number, number>();
  for (const [b, n] of list) {
    if (!Number.isInteger(b) || b < 0 || !Number.isFinite(n) || n <= 0) continue;
    merged.set(b, (merged.get(b) ?? 0) + n);
  }
  return [...merged.entries()].sort((a, b) => a[0] - b[0]);
}

export type Percentile = { value: number; open: boolean; samples: number };

/** Histogramdan yüzdelik (varsayılan p75). Örnek yoksa null (sıfır uydurulmaz). */
export function percentileFromHistogram(metric: Metric, h: Histogram, q = 0.75): Percentile | null {
  const rows = entries(h);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return null;
  const edges = EDGES[metric];
  const target = q * total;
  let cum = 0;
  for (const [b, n] of rows) {
    if (cum + n >= target) {
      const lower = b === 0 ? 0 : edges[Math.min(b, edges.length) - 1]!;
      if (b >= edges.length) return { value: lower, open: true, samples: total };
      const upper = edges[b]!;
      const frac = n > 0 ? (target - cum) / n : 1;
      return { value: round(metric, lower + (upper - lower) * frac), open: false, samples: total };
    }
    cum += n;
  }
  const last = rows[rows.length - 1]![0];
  return { value: last >= edges.length ? edges[edges.length - 1]! : edges[last]!, open: last >= edges.length, samples: total };
}

/** "İyi" eşiği altında kalan örneklerin payı (0..1); örnek yoksa null. */
export function goodShare(metric: Metric, h: Histogram): number | null {
  const rows = entries(h);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return null;
  const goodIdx = EDGES[metric].indexOf(THRESHOLDS[metric].good);
  const good = rows.filter(([b]) => b <= goodIdx).reduce((s, [, n]) => s + n, 0);
  return good / total;
}

export type Verdict = "iyi" | "gelistirilmeli" | "kotu";

export function verdictOf(metric: Metric, value: number): Verdict {
  const t = THRESHOLDS[metric];
  return value <= t.good ? "iyi" : value <= t.poor ? "gelistirilmeli" : "kotu";
}

export const VERDICT_LABEL: Record<Verdict, string> = { iyi: "iyi", gelistirilmeli: "geliştirilmeli", kotu: "yavaş" };

function round(metric: Metric, v: number): number {
  return metric === "CLS" ? Math.round(v * 1000) / 1000 : Math.round(v);
}

/** Kullanıcıya gösterilen değer metni: ms → "2,1 sn" / "180 ms", CLS → "0,08". */
export function formatMetric(metric: Metric, value: number): string {
  if (metric === "CLS") return value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (value >= 1000) return `${(value / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} sn`;
  return `${Math.round(value)} ms`;
}

const DEVICE_WORD = { mobile: "Telefonda", desktop: "Bilgisayarda", all: "Ziyaretçilerinizde" } as const;

/**
 * Teknik olmayan tek cümle. Örn. "Telefonda sayfalarınız 2,1 sn'de açılıyor — iyi".
 * Metrik adı (LCP/INP/CLS) cümlede geçmez; kutucuğun ikincil satırında kalır.
 */
export function sentenceFor(metric: Metric, p: Percentile, device: keyof typeof DEVICE_WORD = "all"): string {
  const v = verdictOf(metric, p.value);
  const label = VERDICT_LABEL[v];
  const val = `${p.open ? "en az " : ""}${formatMetric(metric, p.value)}`;
  const who = DEVICE_WORD[device];
  switch (metric) {
    case "LCP":
      return `${who} sayfalarınız ${val}'de açılıyor — ${label}`;
    case "INP":
      return `${who} sayfalarınız dokunuşa ${val}'de tepki veriyor — ${label}`;
    case "CLS":
      return v === "iyi"
        ? `${who} sayfa açılırken içerik yerinden pek oynamıyor (${val}) — ${label}`
        : `${who} sayfa açılırken içerik kayıyor (${val}) — ${label}`;
    case "FCP":
      return `${who} ilk görüntü ${val}'de beliriyor — ${label}`;
    case "TTFB":
      return `${who} sunucu ilk yanıtı ${val}'de veriyor — ${label}`;
  }
}
