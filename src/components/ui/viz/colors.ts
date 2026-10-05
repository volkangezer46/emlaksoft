/**
 * Veri görselleştirme renkleri — TEK kaynak CSS tokenlarıdır (tokens.css / theme-dark.css
 * `--viz-*`). Bu dosya yalnız adları dizer; hex yazılmaz (iki temada da token çözer).
 */
export const VIZ_SERIES = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
  "var(--viz-8)",
] as const;

/** Sıralı (tek hue) palet: düşük → yüksek. */
export const VIZ_SEQ = [
  "var(--viz-seq-1)",
  "var(--viz-seq-2)",
  "var(--viz-seq-3)",
  "var(--viz-seq-4)",
  "var(--viz-seq-5)",
] as const;

export type VizTone = "brand" | "accent" | "success" | "warn" | "danger" | "gold" | "neutral";

/** Ton → renk. Verilmezse seri sırasına göre kategorik renk. */
export function vizToneColor(tone: VizTone | undefined, index = 0): string {
  switch (tone) {
    case "brand":
    case "accent":
      return index === 0 ? "var(--accent)" : VIZ_SERIES[index % VIZ_SERIES.length];
    case "success":
      return "var(--viz-pos)";
    case "warn":
      return "var(--viz-5)";
    case "danger":
      return "var(--viz-neg)";
    case "gold":
      return "var(--viz-gold)";
    case "neutral":
      return "var(--viz-neutral)";
    default:
      return VIZ_SERIES[index % VIZ_SERIES.length];
  }
}

export type VizFormat = "number" | "money" | "percent";

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

/** tr-TR biçimleme (grafik etiketi, title ve sr-only tablo ortak). */
export function formatViz(value: number, format: VizFormat = "number"): string {
  if (!Number.isFinite(value)) return "—";
  if (format === "money") return money.format(Math.round(value));
  if (format === "percent") return `%${nf.format(value)}`;
  return nf.format(value);
}
