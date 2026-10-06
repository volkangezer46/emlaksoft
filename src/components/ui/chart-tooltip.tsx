import type { ReactNode } from "react";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { formatChartValue, type ChartValueFormat } from "@/components/ui/chart-format";

/**
 * ChartTooltip — TEK grafik ipucu (Recharts `content`). Açık/koyu temada token renkli
 * (`--surface-raised`, `--viz-tooltip-text`), opak (cam yok), metin AA. Recharts içe
 * aktarmaz; her grafik (AreaTrend, BarCompare, DonutSplit, AreaTrendChart, yerel tıklanabilir
 * grafikler) bunu kullanır — ikinci ipucu bileşeni yazılmaz.
 */
export type ChartTooltipItem = {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  payload?: { fill?: string } & Record<string, unknown>;
};

export function ChartTooltip({
  active,
  payload,
  label,
  format = "number",
  formatValue,
  hint,
  hideLabel = false,
}: {
  active?: boolean;
  payload?: readonly ChartTooltipItem[];
  label?: string | number;
  format?: ChartValueFormat;
  /** Özel biçimleyici (verilirse `format`ı ezer). */
  formatValue?: (n: number) => string;
  /** Alt satır (ör. "Ayrıntı için tıklayın"). */
  hint?: ReactNode;
  hideLabel?: boolean;
}) {
  const items = (payload ?? []).filter((p) => p.value !== null && p.value !== undefined && p.value !== "");
  if (!active || items.length === 0) return null;
  const fmt = (n: number) => (formatValue ? formatValue(n) : formatChartValue(n, format));
  return (
    <div className="min-w-36 rounded-[var(--radius-control)] border border-hairline bg-surface-raised px-3 py-2 shadow-[var(--inner-top),var(--elev-4)]">
      {label != null && !hideLabel ? (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      ) : null}
      {items.map((item, index) => (
        <p key={`${item.dataKey ?? item.name ?? index}`} className="flex items-center gap-2 text-sm text-[color:var(--viz-tooltip-text)]">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: item.color ?? item.payload?.fill ?? CHART_COLORS[0] }}
            aria-hidden="true"
          />
          <span className="text-text-muted">{item.name}</span>
          <span className="numeric ml-auto pl-3 font-bold">{fmt(Number(item.value ?? 0))}</span>
        </p>
      ))}
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}
