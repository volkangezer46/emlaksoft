/**
 * Grafik değer biçimleri — recharts içermez (sunucu/istemci güvenli). Grafik bileşenleri ve
 * ortak `ChartTooltip` aynı biçimleyiciyi kullanır (tr-TR; para ₺ tam sayı).
 */
export type ChartValueFormat = "number" | "money" | "percent";

const numberFormatter = new Intl.NumberFormat("tr-TR");
const tryFormatter = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

export function formatChartValue(value: number, format: ChartValueFormat = "number"): string {
  if (format === "money") return tryFormatter.format(value);
  if (format === "percent") return `${value < 0 ? "−" : ""}%${numberFormatter.format(Math.abs(value))}`;
  return numberFormatter.format(value);
}

/**
 * Eksen biçimi: tam Türkçe sayı ("₺18.000.000"); kısaltma yok (sahip kuralı). `prefix` para eksenlerinde "₺".
 */
export function formatChartAxis(value: number, compact = true, prefix = ""): string {
  // Kısaltma (bin/Mn/Mr) YOK: tutarlar her yerde tam biçimde ("₺18.000.000"). Negatifte işaret simgeden önce: "−₺57.050".
  const v = compact ? Math.round(value) : value;
  const sign = v < 0 ? "−" : "";
  return `${sign}${prefix}${numberFormatter.format(Math.abs(v))}`;
}

/**
 * Y ekseni sütun genişliği (px): en uzun tam etiketin ("₺1.000.000") sığacağı genişlik — sabit 48/68 px'te uzun tutar
 * soldan kırpılıyordu. `values` serideki ham değerler; üst "güzel" tick için %25 pay bırakılır. 12 px yazıda rakam ≈ 7 px.
 */
export function chartAxisWidth(values: readonly unknown[], format: ChartValueFormat = "number"): number {
  let max = 0;
  let neg = false;
  for (const v of values) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < 0) neg = true;
    max = Math.max(max, Math.abs(n));
  }
  const prefix = format === "money" ? "₺" : format === "percent" ? "%" : "";
  const label = formatChartAxis(Math.ceil(max * 1.25), true, prefix);
  return Math.max(36, Math.ceil((label.length + (neg ? 1 : 0)) * 7 + 10));
}
