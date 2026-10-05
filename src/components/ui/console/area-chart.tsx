import { cn } from "@/lib/utils";
import { AreaChart as VizAreaChart } from "../viz/area-chart";

export type ChartPoint = { label: string; value: number };

/**
 * Alan grafiği — viz `AreaChart`'a yönlenen sarmalayıcı (eski dışa aktarım korunur).
 * Yalnız GERÇEK seri için çağır: <2 nokta ise `null` döner, çağıran anlamlı boş durum
 * gösterir. `id` artık gerekmez (viz kendi kimliğini üretir) ama imza uyumu için kabul edilir.
 * Erişilebilirlik: role="img" + özet etiketi + sr-only veri tablosu.
 */
export function AreaChart({
  data,
  ariaLabel,
  format = (n) => String(n),
  tone = "accent",
  className,
}: {
  data: readonly ChartPoint[];
  /** Eski imza uyumu: kullanılmaz. */
  id?: string;
  ariaLabel: string;
  format?: (n: number) => string;
  tone?: "accent" | "gold";
  className?: string;
}) {
  if (data.length < 2) return null;
  return (
    <VizAreaChart
      series={[{ name: ariaLabel, values: data.map((d) => d.value), tone: tone === "gold" ? "gold" : "accent" }]}
      pointLabels={data.map((d) => d.label)}
      height={168}
      formatValue={format}
      ariaLabel={ariaLabel}
      className={cn(className)}
    />
  );
}
