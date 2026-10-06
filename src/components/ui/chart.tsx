"use client";

import { useId } from "react";
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
import { ChartFrame } from "@/components/ui/chart-frame";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { formatChartAxis, formatChartValue, type ChartValueFormat } from "@/components/ui/chart-format";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";

/**
 * Grafikler — Recharts üzerine EmlakSoft teması.
 *
 * Neden Recharts: SVG tabanlı, MIT, React 19 uyumlu ve renkleri doğrudan
 * CSS değişkeni olarak kabul ediyor — yani paletimizi ikinci kez tanımlamıyoruz.
 * Palet `--viz-1..8` tokenlarıdır (chart-colors.ts; iki temada kontrastı
 * sözleşme testiyle korunur). İpucu TEK bileşendir: `ChartTooltip` (chart-tooltip.tsx).
 *
 * Props serileştirilebilir (düz dizi + string anahtar), bu yüzden Server
 * Component sayfalardan doğrudan çağrılabilir. İlk yük JS'ine girmemesi için
 * sayfalar bu modülü tembel kapıdan (`@/components/ui/lazy-charts`) alır.
 */

export { CHART_COLORS, ChartTooltip, ChartFrame };
export type { ChartValueFormat };

/**
 * Hareket azaltma: Recharts'ın kendi giriş animasyonu (`isAnimationActive`) kapatılır.
 * Sunucu/hidrasyon anlık görüntüsü "azalt" (animasyonsuz) → hidrasyon sonrası gerçek tercih
 * (animated-number.tsx deseni). Süre `--motion-draw` (600 ms) ile aynıdır.
 */
const DRAW_MS = 600;

const axisProps = {
  stroke: "var(--text-faint)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

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
  const reduce = useReducedMotion();
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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={48} tickFormatter={(v: number) => formatChartAxis(v, compactAxis)} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: "var(--brand-300)", strokeWidth: 1 }} />
        {series.length > 1 ? (
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
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
              isAnimationActive={!reduce}
              animationDuration={DRAW_MS}
              animationEasing="ease-out"
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
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--viz-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={(v: number) => formatChartAxis(v)} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} width={48} tickFormatter={(v: number) => formatChartAxis(v)} />
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
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
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
  const reduce = useReducedMotion();
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
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          >
            {data.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
        <p className="numeric font-display text-xl font-extrabold tracking-[-0.02em] text-[color:var(--viz-tooltip-text)]">
          {formatChartValue(total, format)}
        </p>
        {centerLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">{centerLabel}</p>
        ) : null}
      </div>
    </div>
  );
}

// ---- AreaTrendChart (tasarım sistemi v4) ---------------------------------------

export type TrendPoint = {
  label: string;
  /** Gerçek değer; tahmin noktasında null. */
  value: number | null;
  /** Tahmin değeri (kesikli çizgi); son gerçek noktada değerle aynı verilir ki çizgi kopmasın. */
  forecast?: number | null;
};

const TREND_TONE = {
  gold: "var(--viz-gold)",
  brand: "var(--viz-1)",
  success: "var(--viz-2)",
  violet: "var(--viz-4)",
} as const;

type DotProps = { cx?: number; cy?: number; index?: number; value?: number | null };

/**
 * AreaTrendChart — tek seri premium alan grafiği: altın (para) veya mavi çizgi, alttan sönen
 * degrade dolgu, SON gerçek noktada halka + değer etiketi, isteğe bağlı kesikli TAHMİN uzantısı.
 * Dönem/filtre değişince `animationKey` ile yeniden çizilir (500 ms ease-out; reduce'ta yok).
 * Ekran okuyucu için sr-only veri tablosu; ipucu ortak `ChartTooltip`.
 */
export function AreaTrendChart({
  data,
  tone = "gold",
  format = "money",
  formatValue,
  name = "Değer",
  forecastName = "Tahmin",
  showLastLabel = true,
  animationKey,
  ariaLabel,
}: {
  data: readonly TrendPoint[];
  tone?: keyof typeof TREND_TONE;
  format?: ChartValueFormat;
  formatValue?: (n: number) => string;
  name?: string;
  forecastName?: string;
  showLastLabel?: boolean;
  animationKey?: string | number;
  ariaLabel?: string;
}) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, "");
  const color = TREND_TONE[tone];
  const fmt = (n: number) => (formatValue ? formatValue(n) : formatChartValue(n, format));
  let lastIdx = -1;
  data.forEach((d, i) => {
    if (d.value !== null && Number.isFinite(d.value)) lastIdx = i;
  });
  const hasForecast = data.some((d) => d.forecast !== null && d.forecast !== undefined);
  const rows = data.map((d) => ({ label: d.label, value: d.value, forecast: d.forecast ?? null }));

  const renderDot = (props: DotProps) => {
    const { cx, cy, index, value } = props;
    if (index !== lastIdx || cx === undefined || cy === undefined || value === null || value === undefined) {
      return <g key={`d-${index}`} />;
    }
    const text = fmt(Number(value));
    const w = Math.max(48, text.length * 7.4 + 18);
    return (
      <g key={`d-${index}`}>
        <circle cx={cx} cy={cy} r={10} fill={color} opacity={0.18} />
        <circle cx={cx} cy={cy} r={5} fill="var(--surface-raised)" stroke={color} strokeWidth={3} />
        {showLastLabel ? (
          <g transform={`translate(${Math.max(4, cx - w + 8)}, ${Math.max(2, cy - 38)})`}>
            <rect width={w} height={24} rx={8} fill="var(--surface-raised)" stroke="var(--hairline-strong)" />
            <text x={w / 2} y={16} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--viz-tooltip-text)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {text}
            </text>
          </g>
        ) : null}
      </g>
    );
  };

  return (
    <figure className="relative h-full" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart key={animationKey} data={rows} margin={{ top: 40, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`atc-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" stroke="var(--viz-grid)" vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axisProps} width={44} tickFormatter={(v: number) => formatChartAxis(v)} />
          <Tooltip
            content={<ChartTooltip formatValue={fmt} />}
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={name}
            stroke={color}
            strokeWidth={2.4}
            fill={`url(#atc-${gid})`}
            connectNulls={false}
            dot={renderDot}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-raised)" }}
            isAnimationActive={!reduce}
            animationDuration={500}
            animationEasing="ease-out"
          />
          {hasForecast ? (
            <Area
              type="monotone"
              dataKey="forecast"
              name={forecastName}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              connectNulls={false}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 2, stroke: "var(--surface-raised)" }}
              isAnimationActive={!reduce}
              animationDuration={500}
              animationEasing="ease-out"
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>{ariaLabel ?? name}</caption>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.label}-${i}`}>
              <th scope="row">{r.label}</th>
              <td>{r.value !== null ? fmt(r.value) : r.forecast !== null ? `${forecastName}: ${fmt(r.forecast)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
