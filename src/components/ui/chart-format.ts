/**
 * Grafik değer biçimleri — recharts içermez (sunucu/istemci güvenli). Grafik bileşenleri ve
 * ortak `ChartTooltip` aynı biçimleyiciyi kullanır (tr-TR; para ₺ tam sayı).
 */
export type ChartValueFormat = "number" | "money" | "percent";

const numberFormatter = new Intl.NumberFormat("tr-TR");
const compactFormatter = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const oneDecimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const tryFormatter = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export function formatChartValue(value: number, format: ChartValueFormat = "number"): string {
  if (format === "money") return tryFormatter.format(value);
  if (format === "percent") return `%${numberFormatter.format(value)}`;
  return numberFormatter.format(value);
}

/**
 * Eksen için kısa Türkçe biçim: "18 bin", "1,2 Mn", "2 Mr" ("18 B" belirsizdi). `prefix` para eksenlerinde "₺".
 * Kısa sayı ondalığı en çok 1 hane; tam sayıda ondalık yok.
 */
export function formatChartAxis(value: number, compact = true, prefix = ""): string {
  if (!compact) return `${prefix}${numberFormatter.format(value)}`;
  const abs = Math.abs(value);
  const one = (n: number) => oneDecimal.format(n);
  if (abs >= 1e9) return `${prefix}${one(value / 1e9)} Mr`;
  if (abs >= 1e6) return `${prefix}${one(value / 1e6)} Mn`;
  if (abs >= 1e3) return `${prefix}${one(value / 1e3)} bin`;
  return `${prefix}${compactFormatter.format(value)}`;
}
