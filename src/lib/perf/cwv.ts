/**
 * Core Web Vitals eşikleri ve derecelendirme (SAF). Kaynak: web.dev (iyi / iyileştirilmeli / kötü).
 * TBT laboratuvar ölçüsüdür (INP'nin laboratuvardaki vekili); eşikleri Lighthouse puanlamasından.
 */
export type MetricKey = "lcp_ms" | "inp_ms" | "cls" | "tbt_ms" | "ttfb_ms";
export type Rating = "iyi" | "orta" | "kotu";

export const CWV_THRESHOLDS: Record<MetricKey, { good: number; poor: number }> = {
  lcp_ms: { good: 2500, poor: 4000 },
  inp_ms: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
  tbt_ms: { good: 200, poor: 600 },
  ttfb_ms: { good: 800, poor: 1800 },
};

export const METRIC_LABELS: Record<MetricKey, string> = {
  lcp_ms: "En büyük içerik (LCP)",
  inp_ms: "Etkileşim gecikmesi (INP)",
  cls: "Düzen kayması (CLS)",
  tbt_ms: "Ana iş parçacığı engeli (TBT)",
  ttfb_ms: "İlk bayt süresi (TTFB)",
};

export function rateMetric(key: MetricKey, value: number | null | undefined): Rating | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const t = CWV_THRESHOLDS[key];
  if (value <= t.good) return "iyi";
  if (value <= t.poor) return "orta";
  return "kotu";
}

/** Gösterim: ms → "1,8 sn" / "320 ms"; CLS → "0,05". */
export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (key === "cls") return value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (value >= 1000) return `${(value / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn`;
  return `${Math.round(value)} ms`;
}

/** PSI puanı derecesi (0-100): ≥90 iyi, ≥50 orta. */
export function rateScore(score: number | null | undefined): Rating | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return score >= 90 ? "iyi" : score >= 50 ? "orta" : "kotu";
}
