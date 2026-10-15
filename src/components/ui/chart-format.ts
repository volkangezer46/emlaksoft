/**
 * Grafik değer biçimleri — recharts içermez (sunucu/istemci güvenli). Grafik bileşenleri ve
 * ortak `ChartTooltip` aynı biçimleyiciyi kullanır (tr-TR; para ₺ tam sayı).
 */
export type ChartValueFormat = "number" | "money" | "percent";

const numberFormatter = new Intl.NumberFormat("tr-TR");
const oneDecimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const tryFormatter = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export function formatChartValue(value: number, format: ChartValueFormat = "number"): string {
  if (format === "money") return tryFormatter.format(value);
  if (format === "percent") return `%${numberFormatter.format(value)}`;
  return numberFormatter.format(value);
}

/**
 * Eksen biçimi: tam Türkçe sayı ("₺18.000.000"); kısaltma yok (sahip kuralı). `prefix` para eksenlerinde "₺".
 */
export function formatChartAxis(value: number, compact = true, prefix = ""): string {
  if (!compact) return `${prefix}${numberFormatter.format(value)}`;
  const abs = Math.abs(value);
  const one = (n: number) => oneDecimal.format(n);
  // Kısaltma (bin/Mn/Mr) YOK: tutarlar her yerde tam biçimde ("₺18.000.000").
  void abs;
  void one;
  return `${prefix}${numberFormatter.format(Math.round(value))}`;
}
