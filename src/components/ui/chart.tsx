"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Grafikler — Recharts üzerine EmlakSoft teması.
 *
 * Neden Recharts: SVG tabanlı, MIT, React 19 uyumlu ve renkleri doğrudan
 * CSS değişkeni olarak kabul ediyor — yani paletimizi ikinci kez tanımlamıyoruz.
 * Palette bilinçli olarak globals.css'teki sıra: brand → mint → cyan → amber →
 * ink → danger. Mor yok (tasarım sistemi kuralı).
 *
 * Props serileştirilebilir (düz dizi + string anahtar), bu yüzden Server
 * Component sayfalardan doğrudan çağrılabilir.
 */

export const CHART_COLORS = [
  "var(--brand-600)",
  "var(--mint-500)",
  "var(--cyan-400)",
  "var(--amber-400)",
  "var(--ink-700)",
  "var(--danger-500)",
] as const;

const numberFormatter = new Intl.NumberFormat("tr-TR");
const compactFormatter = new Intl.NumberFormat("tr-TR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export type ChartValueFormat = "number" | "money" | "percent";

function formatValue(value: number, format: ChartValueFormat = "number") {
  if (format === "money") return tryFormatter.format(value);
  if (format === "percent") return `%${numberFormatter.format(value)}`;
  return numberFormatter.format(value);
}

/** Kart çerçevesi — panel kartlarıyla aynı yüzey/gölge/köşe değerleri. */
export function ChartFrame({
  title,
  subtitle,
  action,
  children,
  className,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <section
      className={cn("surface-card rounded-[var(--radius-panel)] p-5", className)}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold tracking-[-0.015em] text-ink-950">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.04em] text-text-faint">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      <div style={{ height }}>{children}</div>
    </section>
  );
}

const axisProps = {
  stroke: "var(--text-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

type TooltipPayloadItem = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  format?: ChartValueFormat;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[11px] border border-hairline bg-surface/95 px-3 py-2 shadow-[var(--inner-top),var(--elev-4)] backdrop-blur-sm">
      {label != null ? (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          {label}
        </p>
      ) : null}
      {payload.map((item, index) => (
        <p key={index} className="flex items-center gap-2 text-sm text-ink-950">
          <span
            className="h-2 w-2 shrink-0 rounded-full ring-2 ring-inset ring-white/40"
            style={{ background: item.color ?? CHART_COLORS[0] }}
          />
          <span className="text-text-muted">{item.name}</span>
          <span className="numeric ml-auto font-bold">
            {formatValue(Number(item.value ?? 0), format)}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Zaman serisi / trend — gradient dolgulu alan grafiği. */
export function AreaTrend({
  data,
  xKey,
  series,
  format = "number",
  compactAxis = true,
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  format?: ChartValueFormat;
  compactAxis?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, index) => {
            const color = s.color ?? CHART_COLORS[index % CHART_COLORS.length];
            return (
              <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis
          {...axisProps}
          width={48}
          tickFormatter={(v: number) =>
            compactAxis ? compactFormatter.format(v) : numberFormatter.format(v)
          }
        />
        <Tooltip
          content={<ChartTooltip format={format} />}
          cursor={{ stroke: "var(--brand-300)", strokeWidth: 1 }}
        />
        {series.length > 1 ? (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }}
          />
        ) : null}
        {series.map((s, index) => {
          const color = s.color ?? CHART_COLORS[index % CHART_COLORS.length];
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2.2}
              fill={`url(#area-${s.key})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Kategori karşılaştırma — danışman performansı, gider kırılımı vb. */
export function BarCompare({
  data,
  xKey,
  series,
  format = "number",
  layout = "vertical",
}: {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  format?: ChartValueFormat;
  /** "vertical" = klasik dikey çubuk; "horizontal" = uzun etiketler için yatay. */
  layout?: "vertical" | "horizontal";
}) {
  const horizontal = layout === "horizontal";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v: number) => compactFormatter.format(v)} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} width={48} tickFormatter={(v: number) => compactFormatter.format(v)} />
          </>
        )}
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ fill: "var(--brand-600)", fillOpacity: 0.05 }} />
        {series.length > 1 ? (
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        ) : null}
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            radius={horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0]}
            maxBarSize={horizontal ? 18 : 34}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Dağılım — portföy tipi kırılımı, kaynak dağılımı vb. */
export function DonutSplit({
  data,
  nameKey = "name",
  valueKey = "value",
  format = "number",
  centerLabel,
}: {
  data: Array<Record<string, string | number>>;
  nameKey?: string;
  valueKey?: string;
  format?: ChartValueFormat;
  centerLabel?: string;
}) {
  const total = data.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="numeric font-display text-xl font-extrabold tracking-[-0.02em] text-ink-950">
          {formatValue(total, format)}
        </p>
        {centerLabel ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
            {centerLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
