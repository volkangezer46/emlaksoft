"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
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
  Rectangle,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/ui/chart-frame";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { formatChartAxis, formatChartValue, type ChartValueFormat } from "@/components/ui/chart-format";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { TubeGradient } from "@/components/ui/viz/tube-gradient";

/**
 * Grafikler — Recharts üzerine EmlakSoft teması (TEK grafik seti; sayfalar doğrudan `recharts` içe aktarmaz).
 *
 * Neden Recharts: SVG tabanlı, MIT, React 19 uyumlu ve renkleri doğrudan
 * CSS değişkeni olarak kabul ediyor — yani paletimizi ikinci kez tanımlamıyoruz.
 * Palet `--viz-1..8` tokenlarıdır (chart-colors.ts; iki temada kontrastı
 * sözleşme testiyle korunur). İpucu TEK bileşendir: `ChartTooltip` (chart-tooltip.tsx).
 *
 * DERİNLİK DİLİ (WebGL yok, SVG filtresi yok; CSS `src/app/viz.css`, token `--viz-sheen/shade/shadow/glow`):
 *  - Çubuk: yuvarlatılmış uç + üstten ışık degradesi + alt gölge hattı; üzerine gelinen çubuk öne çıkar, diğerleri söner.
 *  - Halka: dilim başına iç kenarda koyu ton (kalınlık), dış kenarda ince ışık; etkin dilim dışarı taşar + gölge.
 *  - Alan: katmanlı (3 duraklı) degrade + çizginin altında kalın/yarı saydam parlama eğrisi; etkin nokta gölgeli.
 *  - Eksen/ızgara sade: yalnız yatay kesikli ızgara, en çok 4-5 değer etiketi, eksen çizgisi yok.
 *  - Dönem değişimi: aynı bileşen yeni veriyle çizilince Recharts eski değerden yeniye canlandırır (reduce'ta yok).
 *
 * Tıklanabilir grafik (sıfır çıkmaz metrik): `hrefKey` verilirse satırdaki o alan (ör. "href") hedef adrestir;
 * çubuğa/dilime tıklayınca oraya gidilir. Props serileştirilebilir (düz dizi + string anahtar), bu yüzden Server
 * Component sayfalardan doğrudan çağrılabilir. İlk yük JS'ine girmemesi için sayfalar bu modülü tembel kapıdan
 * (`@/components/ui/lazy-charts`) alır.
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
  stroke: "var(--text-muted)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const gridProps = { strokeDasharray: "2 5", stroke: "var(--viz-grid)", strokeOpacity: 0.5 } as const;

type Row = Record<string, string | number>;

/** Üstten ışık degradesi (çubuk ve halka için ortak); kimlik grafik başına benzersizdir. */
function SheenDefs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--viz-sheen)" />
        <stop offset="70%" stopColor="var(--viz-sheen)" stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

type BarShapeLike = { x?: number; y?: number; width?: number; height?: number; fill?: string; isActive?: boolean };

/** Kabartmalı çubuk: yuvarlatılmış uç + ışık katmanı + taban gölge hattı. Etkinse `data-active` (viz.css). */
function depthBar(horizontal: boolean, sheenId: string) {
  return function renderDepthBar(props: BarShapeLike) {
    const x0 = Number(props.x ?? 0);
    const y0 = Number(props.y ?? 0);
    const w0 = Number(props.width ?? 0);
    const h0 = Number(props.height ?? 0);
    // Negatif değerde Recharts ters yönlü boyut verir; geometriyi normalize et.
    const x = w0 < 0 ? x0 + w0 : x0;
    const y = h0 < 0 ? y0 + h0 : y0;
    const width = Math.abs(w0);
    const height = Math.abs(h0);
    if (!(width > 0) || !(height > 0)) return <g />;
    const r = Math.min(6, (horizontal ? height : width) / 2, horizontal ? width : height);
    const radius: [number, number, number, number] = horizontal ? [0, r, r, 0] : [r, r, 0, 0];
    const shade = Math.min(2, height / 3);
    return (
      <g className="viz-bar" data-active={props.isActive ? "true" : undefined}>
        <Rectangle x={x} y={y} width={width} height={height} radius={radius} fill={props.fill} />
        <Rectangle x={x} y={y} width={width} height={height} radius={radius} fill={`url(#${sheenId})`} pointerEvents="none" />
        {/* Yan yüz (sağda koyu ince şerit) + üst yüz parlaması: hafif izometrik derinlik (perspektif yok, oran bozulmaz). */}
        {!horizontal && width >= 10 ? (
          <rect x={x + width - Math.min(5, width / 4)} y={y + r} width={Math.min(5, width / 4)} height={Math.max(0, height - r)} fill="var(--viz-shade)" pointerEvents="none" />
        ) : null}
        {horizontal && height >= 10 ? (
          <rect x={x} y={y + height - Math.min(4, height / 4)} width={Math.max(0, width - r)} height={Math.min(4, height / 4)} fill="var(--viz-shade)" pointerEvents="none" />
        ) : null}
        <Rectangle
          x={x}
          y={y}
          width={horizontal ? Math.min(3, width) : width}
          height={horizontal ? height : Math.min(3, height)}
          radius={radius}
          fill="var(--viz-sheen)"
          pointerEvents="none"
        />
        <rect x={x} y={y + height - shade} width={horizontal ? Math.max(0, width - r) : width} height={shade} fill="var(--viz-shade)" pointerEvents="none" />
      </g>
    );
  };
}

type SectorShapeLike = {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
  isActive?: boolean;
};

/** Kalınlık hissi veren dilim: ana dilim + üstünde tüp degradesi (iç kenar gölge → dış kenar ışık); etkin dilim 4 px dışarı. */
function depthSector(idPrefix: string) {
  return function renderDepthSector(props: SectorShapeLike & { index?: number }) {
    const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill, isActive } = props;
    const out = isActive ? outerRadius + 4 : outerRadius;
    const common = { cx, cy, startAngle, endAngle, innerRadius, outerRadius: out, cornerRadius: 3 };
    const gid = `${idPrefix}-${props.index ?? 0}`;
    return (
      <g className="viz-sector" data-active={isActive ? "true" : undefined}>
        <defs>
          <TubeGradient id={gid} cx={cx} cy={cy} inner={innerRadius} outer={out} />
        </defs>
        <Sector {...common} fill={fill} />
        <Sector {...common} fill={`url(#${gid})`} pointerEvents="none" />
        {/* İç kenar gölgesi + dış kenar ince ışık: halka kalınlığı */}
        <Sector {...common} outerRadius={innerRadius + 3} fill="var(--viz-shade)" pointerEvents="none" />
        <Sector {...common} innerRadius={Math.max(innerRadius, out - 1.5)} fill="var(--viz-sheen)" pointerEvents="none" />
      </g>
    );
  };
}

/** Tıklanan öğenin satırındaki hedef adres (yalnız uygulama içi yol kabul edilir). */
function hrefOf(entry: unknown, hrefKey: string | undefined): string | null {
  if (!hrefKey) return null;
  const e = entry as { payload?: Row } & Row;
  const v = e?.payload?.[hrefKey] ?? e?.[hrefKey];
  return typeof v === "string" && v.startsWith("/") ? v : null;
}

/** Zaman serisi / trend — katmanlı degrade dolgulu alan grafiği (+ çizgi parlaması). */
export function AreaTrend({
  data,
  xKey,
  series,
  format = "number",
  compactAxis = true,
}: {
  data: Row[];
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  format?: ChartValueFormat;
  compactAxis?: boolean;
}) {
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, "");
  return (
    <ResponsiveContainer width="100%" height="100%" className="viz-depth">
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, index) => {
            const color = s.color ?? CHART_COLORS[index % CHART_COLORS.length];
            return (
              <linearGradient key={s.key} id={`area-${gid}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.42} />
                <stop offset="45%" stopColor={color} stopOpacity={0.16} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid {...gridProps} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={12} />
        <YAxis {...axisProps} width={48} tickCount={4} tickFormatter={(v: number) => formatChartAxis(v, compactAxis)} />
        <Tooltip content={<ChartTooltip format={format} />} cursor={{ stroke: "var(--brand-300)", strokeWidth: 1, strokeDasharray: "3 3" }} />
        {series.length > 1 ? (
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        ) : null}
        {series.map((s, index) => {
          const color = s.color ?? CHART_COLORS[index % CHART_COLORS.length];
          return (
            <Area
              key={`sh-${s.key}`}
              className="viz-shadow-line"
              type="monotone"
              dataKey={s.key}
              stroke={color}
              strokeWidth={4}
              fill="none"
              dot={false}
              activeDot={false}
              legendType="none"
              tooltipType="none"
              isAnimationActive={!reduce}
              animationDuration={DRAW_MS}
              animationEasing="ease-out"
            />
          );
        })}
        {series.map((s, index) => {
          const color = s.color ?? CHART_COLORS[index % CHART_COLORS.length];
          return (
            <Area
              key={`g-${s.key}`}
              className="viz-glow"
              type="monotone"
              dataKey={s.key}
              stroke={color}
              strokeWidth={7}
              fill="none"
              dot={false}
              activeDot={false}
              legendType="none"
              tooltipType="none"
              isAnimationActive={!reduce}
              animationDuration={DRAW_MS}
              animationEasing="ease-out"
            />
          );
        })}
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
              fill={`url(#area-${gid}-${index})`}
              dot={false}
              isAnimationActive={!reduce}
              animationDuration={DRAW_MS}
              animationEasing="ease-out"
              activeDot={{ r: 5, strokeWidth: 2.5, stroke: "var(--surface-raised)", fill: color, className: "viz-dot" }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Kategori karşılaştırma — danışman performansı, gider kırılımı vb. `hrefKey` ile çubuk tıklanabilir. */
export function BarCompare({
  data,
  xKey,
  series,
  format = "number",
  layout = "vertical",
  hrefKey,
  hint,
}: {
  data: Row[];
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  format?: ChartValueFormat;
  /** "vertical" = klasik dikey çubuk; "horizontal" = uzun etiketler için yatay. */
  layout?: "vertical" | "horizontal";
  /** Satırdaki hedef adres alanı (ör. "href"); verilirse çubuğa tıklayınca o filtreli sayfaya gidilir. */
  hrefKey?: string;
  /** İpucunun alt satırı (ör. "Ayrıntı için tıklayın"). */
  hint?: string;
}) {
  const horizontal = layout === "horizontal";
  const reduce = useReducedMotion();
  const router = useRouter();
  const sheenId = `sheen-${useId().replace(/:/g, "")}`;
  const shape = depthBar(horizontal, sheenId);
  return (
    <ResponsiveContainer width="100%" height="100%" className="viz-depth">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 6, right: 12, left: horizontal ? 8 : 0, bottom: 0 }}
        barGap={4}
      >
        <SheenDefs id={sheenId} />
        <CartesianGrid {...gridProps} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axisProps} tickCount={5} tickFormatter={(v: number) => formatChartAxis(v)} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={110} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} minTickGap={8} />
            <YAxis {...axisProps} width={format === "money" ? 68 : 48} tickCount={4} tickFormatter={(v: number) => formatChartAxis(v, true, format === "money" ? "₺" : "")} />
          </>
        )}
        <Tooltip content={<ChartTooltip format={format} hint={hint} />} cursor={{ fill: "var(--accent)", fillOpacity: 0.05 }} />
        {series.length > 1 ? (
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        ) : null}
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color ?? CHART_COLORS[index % CHART_COLORS.length]}
            maxBarSize={horizontal ? 18 : 34}
            shape={shape}
            activeBar
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
            cursor={hrefKey ? "pointer" : undefined}
            onClick={
              hrefKey
                ? (entry: unknown) => {
                    const href = hrefOf(entry, hrefKey);
                    if (href) router.push(href);
                  }
                : undefined
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Dağılım — portföy tipi kırılımı, kaynak dağılımı vb. `hrefKey` ile dilim tıklanabilir. */
export function DonutSplit({
  data,
  nameKey = "name",
  valueKey = "value",
  format = "number",
  centerLabel,
  hrefKey,
  hint,
}: {
  data: Row[];
  nameKey?: string;
  valueKey?: string;
  format?: ChartValueFormat;
  centerLabel?: string;
  /** Satırdaki hedef adres alanı (ör. "href"); verilirse dilime tıklayınca o filtreli sayfaya gidilir. */
  hrefKey?: string;
  hint?: string;
}) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const tubeId = `tube-${useId().replace(/:/g, "")}`;
  const total = data.reduce((sum, row) => sum + Number(row[valueKey] ?? 0), 0);
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%" className="viz-depth">
        <PieChart>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            strokeWidth={0}
            shape={depthSector(tubeId)}
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
            cursor={hrefKey ? "pointer" : undefined}
            onClick={
              hrefKey
                ? (entry: unknown) => {
                    const href = hrefOf(entry, hrefKey);
                    if (href) router.push(href);
                  }
                : undefined
            }
          >
            {data.map((_, index) => (
              <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} hint={hint} />} />
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

type DotProps = { cx?: number; cy?: number; index?: number; payload?: { value?: number | null } };

/**
 * AreaTrendChart — tek seri premium alan grafiği: altın (para) veya mavi çizgi, katmanlı degrade dolgu, çizgi
 * parlaması, SON gerçek noktada halka + değer etiketi, isteğe bağlı kesikli TAHMİN uzantısı.
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
    // Recharts 3 Area noktasında `value` [taban, değer] dizisidir (Number(dizi) = NaN); değer satırdan okunur.
    const { cx, cy, index } = props;
    const value = props.payload?.value;
    if (index !== lastIdx || cx === undefined || cy === undefined || typeof value !== "number" || !Number.isFinite(value)) {
      return <g key={`d-${index}`} />;
    }
    const text = fmt(value);
    const w = Math.max(48, text.length * 7.4 + 18);
    return (
      <g key={`d-${index}`}>
        <circle cx={cx} cy={cy} r={10} fill={color} opacity={0.18} className="viz-pulse" />
        <circle cx={cx} cy={cy} r={5} fill="var(--surface-raised)" stroke={color} strokeWidth={3} className="viz-dot" />
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
      <ResponsiveContainer width="100%" height="100%" className="viz-depth">
        <AreaChart key={animationKey} data={rows} margin={{ top: 40, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`atc-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.44} />
              <stop offset="48%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...gridProps} vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
          <YAxis {...axisProps} width={format === "money" ? 68 : 44} tickCount={4} tickFormatter={(v: number) => formatChartAxis(v, true, format === "money" ? "₺" : "")} />
          <Tooltip
            content={<ChartTooltip formatValue={fmt} />}
            cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Area
            className="viz-shadow-line"
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={4}
            fill="none"
            connectNulls={false}
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
            isAnimationActive={!reduce}
            animationDuration={500}
            animationEasing="ease-out"
          />
          <Area
            className="viz-glow"
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={7}
            fill="none"
            connectNulls={false}
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
            isAnimationActive={!reduce}
            animationDuration={500}
            animationEasing="ease-out"
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
            activeDot={{ r: 5, strokeWidth: 2.5, stroke: "var(--surface-raised)", fill: color, className: "viz-dot" }}
            isAnimationActive={!reduce}
            animationDuration={500}
            animationEasing="ease-out"
          />
          <Area
            className="viz-edge"
            type="monotone"
            dataKey="value"
            stroke="var(--viz-sheen)"
            strokeWidth={1}
            fill="none"
            connectNulls={false}
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
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
