import type { ReactNode } from "react";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { formatChartValue, type ChartValueFormat } from "@/components/ui/chart-format";

/**
 * ChartTooltip — TEK grafik ipucu (Recharts `content`). Açık/koyu temada token renkli
 * (`--surface-raised`, `--viz-tooltip-text`), opak (cam yok), metin AA. Recharts içe
 * aktarmaz; her grafik (AreaTrend, BarCompare, DonutSplit, AreaTrendChart, yerel tıklanabilir
 * grafikler) bunu kullanır — ikinci ipucu bileşeni yazılmaz.
 */
const deltaFmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export type ChartTooltipItem = {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  /** Recharts `tooltipType="none"` verilen dekoratif seriler (ör. parlama katmanı) ipucunda listelenmez. */
  type?: string;
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
  deltaRows,
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
  /**
   * Önceki döneme göre fark satırı için TAM veri (görünür aralıktan önceki nokta da dahil). Grafiğe verilen satır
   * nesneleriyle aynı referanslar olmalı (Recharts `payload` satırı bulunur); tabanı 0/boş olan noktada fark gösterilmez.
   */
  deltaRows?: readonly Record<string, unknown>[];
}) {
  const seen = new Set<string>();
  const items = (payload ?? []).filter((p) => {
    if (p.type === "none" || p.value === null || p.value === undefined || p.value === "") return false;
    // Aynı veri anahtarını çizen ikinci katman (parlama/gölge) yalnız bir kez gösterilir.
    const k = String(p.dataKey ?? p.name ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!active || items.length === 0) return null;
  const fmt = (n: number) => (formatValue ? formatValue(n) : formatChartValue(n, format));
  const deltaOf = (item: ChartTooltipItem): number | null => {
    if (!deltaRows || item.dataKey === undefined || typeof item.value !== "number") return null;
    const at = deltaRows.indexOf(item.payload as Record<string, unknown>);
    if (at < 1) return null;
    const prev = deltaRows[at - 1]?.[String(item.dataKey)];
    if (typeof prev !== "number" || !Number.isFinite(prev) || prev === 0) return null;
    return ((item.value - prev) / Math.abs(prev)) * 100;
  };
  return (
    <div className="max-w-[min(18rem,80vw)] min-w-36 rounded-[var(--radius-control)] border border-hairline bg-surface-raised px-3 py-2 shadow-[var(--inner-top),var(--elev-4)]">
      {label != null && !hideLabel ? (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      ) : null}
      {items.map((item, index) => {
        const delta = deltaOf(item);
        return (
          <div key={`${item.dataKey ?? item.name ?? index}`}>
            <p className="flex items-center gap-2 text-sm text-[color:var(--viz-tooltip-text)]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color ?? item.payload?.fill ?? CHART_COLORS[0] }}
                aria-hidden="true"
              />
              <span className="text-text-muted">{item.name}</span>
              <span className="numeric ml-auto pl-3 font-bold">{fmt(Number(item.value ?? 0))}</span>
            </p>
            {delta !== null ? (
              <p
                className="numeric pl-4 text-right text-xs font-semibold"
                style={{ color: delta >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
              >
                {delta >= 0 ? "▲ +" : "▼ −"}%{deltaFmt.format(Math.abs(delta))}
                <span className="font-normal text-text-faint"> önceki döneme göre</span>
              </p>
            ) : null}
          </div>
        );
      })}
      {hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}
