/**
 * Grafik değer biçimleri — recharts içermez (sunucu/istemci güvenli). Grafik bileşenleri ve
 * ortak `ChartTooltip` aynı biçimleyiciyi kullanır (tr-TR; para ₺ tam sayı).
 */
export type ChartValueFormat = "number" | "money" | "percent";

const numberFormatter = new Intl.NumberFormat("tr-TR");
const compactFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const tryFormatter = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export function formatChartValue(value: number, format: ChartValueFormat = "number"): string {
  if (format === "money") return tryFormatter.format(value);
  if (format === "percent") return `%${numberFormatter.format(value)}`;
  return numberFormatter.format(value);
}

/** Eksen için kısa biçim ("16,9 B"); para eksende de kısa sayı (₺ tooltip'te). */
export function formatChartAxis(value: number, compact = true): string {
  return compact ? compactFormatter.format(value) : numberFormatter.format(value);
}
