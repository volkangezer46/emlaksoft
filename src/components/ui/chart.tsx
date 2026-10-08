"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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
import { ChartLegend, type ChartLegendItem } from "@/components/ui/chart-legend";
import { ChartRangePanel, useChartRange } from "@/components/ui/chart-range";
import type { Granularity, RangeSummaryMode } from "@/components/ui/chart-range-math";
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
 *  - Zaman aralığı (chart-range.tsx): sürüklenebilir mini harita + hazır aralık hapları + canlı özet; lejant tıklanınca seri/dilim gizlenir.
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
function depthSector(idPrefix: string, focusKey: string | null = null, nameKey = "name") {
  return function renderDepthSector(props: SectorShapeLike & { index?: number; name?: unknown; payload?: Record<string, unknown> }) {
    const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill } = props;
    // Lejant üzerine gelince ilgili dilim de öne çıkar (etkin dilim dışarı taşar, diğerleri söner — viz.css).
    const isActive = props.isActive || (focusKey !== null && String(props.payload?.[nameKey] ?? props.name ?? "") === focusKey);
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

type SeriesDef = { key: string; label: string; color?: string };

/** Grafik alanı: üst kap akışta yüksekliği belirler, Recharts kabı mutlak konumla tam doldurur (taşma/0 px yok). */
function PlotBox({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0">{children}</div>;
}

type DotProps = { cx?: number; cy?: number; index?: number; payload?: { value?: number | null } };

/**
 * Son gerçek noktada nabız noktası (halka + yayılan parıltı; reduced-motion'da durağan, viz.css) ve isteğe bağlı değer balonu.
 * Recharts 3 Area noktasında `value` [taban, değer] dizisidir; balon değeri satırdan (`payload.value`) okunur.
 */
function lastPointDot(color: string, lastIdx: number, fmt: (n: number) => string, withLabel: boolean, valueOf?: (p: DotProps) => number | null | undefined) {
  return function renderDot(props: DotProps) {
    const { cx, cy, index } = props;
    const value = valueOf ? valueOf(props) : props.payload?.value;
    if (index !== lastIdx || cx === undefined || cy === undefined || typeof value !== "number" || !Number.isFinite(value)) {
      return <g key={`d-${index}`} />;
    }
    const text = fmt(value);
    const w = Math.max(48, text.length * 7.4 + 18);
    return (
      <g key={`d-${index}`}>
        <circle cx={cx} cy={cy} r={10} fill={color} opacity={0.18} className="viz-pulse" />
        <circle cx={cx} cy={cy} r={5} fill="var(--surface-raised)" stroke={color} strokeWidth={3} className="viz-dot" />
        {withLabel ? (
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
}

const crosshair = (color: string) => ({ stroke: color, strokeWidth: 1.5, strokeDasharray: "3 3", strokeOpacity: 0.85 });

/** Seri gösterme/gizleme durumu (en az bir seri açık kalır — ChartLegend). */
function useHiddenSet() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return [hidden, toggle] as const;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Zaman serisi / trend — katmanlı degrade dolgulu alan grafiği (+ çizgi parlaması).
 * Zaman aralığı: yeterli nokta varsa (varsayılan >= 8) altta sürüklenebilir mini harita + hazır aralık hapları +
 * canlı özet (son değer ve değişim %) çıkar; çoklu seride lejanttan seri açılıp kapanır, son noktada nabız noktası vardır.
 */
export function AreaTrend({
  data,
  xKey,
  series,
  format = "number",
  compactAxis = true,
  rangeable,
  granularity = "month",
  summary = "last",
}: {
  data: Row[];
  xKey: string;
  series: SeriesDef[];
  format?: ChartValueFormat;
  compactAxis?: boolean;
  /** Aralık seçici (varsayılan: >= 8 noktada açık). */
  rangeable?: boolean;
  granularity?: Granularity;
  /** Canlı özet: "last" son değer + değişim, "total" aralık toplamı, "none" yok. */
  summary?: RangeSummaryMode;
}) {
  const reducedMotion = useReducedMotion();
  const gid = useId().replace(/:/g, "");
  const [hidden, toggle] = useHiddenSet();
  const [focus, setFocus] = useState<string | null>(null);
  const n = data.length;
  const canRange = (rangeable ?? n >= 8) && n >= 4;
  const { range, setRange, reset, touched } = useChartRange(n);
  // Sürüklerken/aralık değişince yeniden çizim animasyonu yok (canlı his, 60 fps); ilk çizimde var.
  const reduce = reducedMotion || touched;
  const rows = useMemo(() => (canRange ? data.slice(range[0], range[1] + 1) : data), [canRange, data, range]);
  const colorOf = (s: SeriesDef, index: number) => s.color ?? CHART_COLORS[index % CHART_COLORS.length]!;
  const items: ChartLegendItem[] = series.map((s, index) => ({ key: s.key, label: s.label, color: colorOf(s, index) }));
  const firstVisibleIdx = Math.max(0, series.findIndex((s) => !hidden.has(s.key)));
  const lead = series[firstVisibleIdx] ?? series[0];
  const leadColor = lead ? colorOf(lead, firstVisibleIdx) : CHART_COLORS[0]!;
  const labels = useMemo(() => data.map((d) => String(d[xKey] ?? "")), [data, xKey]);
  const leadValues = useMemo(() => data.map((d) => (lead ? finite(d[lead.key]) : null)), [data, lead]);
  const fmt = (v: number) => formatChartValue(v, format);
  const lastIdx = rows.length - 1;

  const chart = (
    <ResponsiveContainer width="100%" height="100%" className="viz-depth">
      <AreaChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, index) => {
            const color = colorOf(s, index);
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
        <Tooltip content={<ChartTooltip format={format} deltaRows={data} />} cursor={crosshair("var(--brand-300)")} />
        {series.map((s, index) => (
          <Area
            key={`sh-${s.key}`}
            className="viz-shadow-line"
            type="monotone"
            dataKey={s.key}
            stroke={colorOf(s, index)}
            strokeWidth={4}
            fill="none"
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
            hide={hidden.has(s.key)}
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          />
        ))}
        {series.map((s, index) => (
          <Area
            key={`g-${s.key}`}
            className="viz-glow"
            type="monotone"
            dataKey={s.key}
            stroke={colorOf(s, index)}
            strokeWidth={7}
            fill="none"
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
            hide={hidden.has(s.key)}
            isAnimationActive={!reduce}
            animationDuration={DRAW_MS}
            animationEasing="ease-out"
          />
        ))}
        {series.map((s, index) => {
          const color = colorOf(s, index);
          const dim = focus !== null && focus !== s.key;
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2.2}
              strokeOpacity={dim ? 0.25 : 1}
              fill={`url(#area-${gid}-${index})`}
              fillOpacity={dim ? 0.3 : 1}
              dot={lastPointDot(color, lastIdx, fmt, false, (p) => finite((p.payload as Row | undefined)?.[s.key]))}
              hide={hidden.has(s.key)}
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="min-h-0 flex-1">
        {canRange ? (
          <ChartRangePanel
            labels={labels}
            values={leadValues}
            range={range}
            onRangeChange={setRange}
            onReset={reset}
            summaryMode={summary}
            formatValue={fmt}
            color={leadColor}
            granularity={granularity}
            summaryLabel={series.length > 1 ? lead?.label : undefined}
          >
            <PlotBox>{chart}</PlotBox>
          </ChartRangePanel>
        ) : (
          <div className="relative h-full">
            <PlotBox>{chart}</PlotBox>
          </div>
        )}
      </div>
      {series.length > 1 ? <ChartLegend items={items} hidden={hidden} onToggle={toggle} onHover={setFocus} /> : null}
    </div>
  );
}

/** Değer etiketi (çubuk ucu): kısa Türkçe biçim. */
function barLabel(format: ChartValueFormat) {
  return (v: unknown) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x === 0) return "";
    if (format === "percent") return `%${formatChartAxis(x, false)}`;
    return formatChartAxis(x, true, format === "money" ? "₺" : "");
  };
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
  showValues,
  colorKey,
}: {
  data: Row[];
  xKey: string;
  series: SeriesDef[];
  format?: ChartValueFormat;
  /** Satır başına çubuk rengi alanı (ör. "renk" = "var(--viz-pos)"); işaretli değerlerde (kâr/zarar) kullanılır. Yalnız tek seride. */
  colorKey?: string;
  /** "vertical" = klasik dikey çubuk; "horizontal" = uzun etiketler için yatay. */
  layout?: "vertical" | "horizontal";
  /** Satırdaki hedef adres alanı (ör. "href"); verilirse çubuğa tıklayınca o filtreli sayfaya gidilir. */
  hrefKey?: string;
  /** İpucunun alt satırı (ör. "Ayrıntı için tıklayın"). */
  hint?: string;
  /** Çubuk ucunda değer etiketi (varsayılan: tek seri ve <= 10 kategori). */
  showValues?: boolean;
}) {
  const horizontal = layout === "horizontal";
  const reduce = useReducedMotion();
  const router = useRouter();
  const sheenId = `sheen-${useId().replace(/:/g, "")}`;
  const shape = depthBar(horizontal, sheenId);
  const [hidden, toggle] = useHiddenSet();
  const [focus, setFocus] = useState<string | null>(null);
  const values = showValues ?? (series.length === 1 && data.length <= 10);
  const colorOf = (s: SeriesDef, index: number) => s.color ?? CHART_COLORS[index % CHART_COLORS.length]!;
  const items: ChartLegendItem[] = series.map((s, index) => ({ key: s.key, label: s.label, color: colorOf(s, index) }));
  const labelFmt = barLabel(format);
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        <PlotBox>
          <ResponsiveContainer width="100%" height="100%" className="viz-depth">
            <BarChart
              data={data}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: values && !horizontal ? 18 : 6, right: values && horizontal ? 44 : 12, left: horizontal ? 8 : 0, bottom: 0 }}
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
              <Tooltip content={<ChartTooltip format={format} hint={hint} />} cursor={{ fill: "var(--accent)", fillOpacity: 0.06 }} />
              {series.map((s, index) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={colorOf(s, index)}
                  fillOpacity={focus !== null && focus !== s.key ? 0.3 : 1}
                  maxBarSize={horizontal ? 18 : 34}
                  shape={shape}
                  activeBar
                  hide={hidden.has(s.key)}
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
                  {colorKey && series.length === 1
                    ? data.map((row, i) => {
                        const c = row[colorKey];
                        return <Cell key={`c-${i}`} fill={typeof c === "string" ? c : colorOf(s, index)} />;
                      })
                    : null}
                  {values ? (
                    <LabelList
                      dataKey={s.key}
                      position={horizontal ? "right" : "top"}
                      formatter={labelFmt}
                      fontSize={12}
                      fontWeight={700}
                      fill="var(--viz-tooltip-text)"
                    />
                  ) : null}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </PlotBox>
      </div>
      {series.length > 1 ? <ChartLegend items={items} hidden={hidden} onToggle={toggle} onHover={setFocus} /> : null}
    </div>
  );
}

/** Dağılım — portföy tipi kırılımı, kaynak dağılımı vb. `hrefKey` ile dilim tıklanabilir; üzerine gelince ortada dilim değeri. */
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
  const [hidden, toggle] = useHiddenSet();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const all = useMemo(
    () =>
      data.map((row, index) => ({
        row,
        key: String(row[nameKey] ?? index),
        color: CHART_COLORS[index % CHART_COLORS.length]!,
        value: Number(row[valueKey] ?? 0),
      })),
    [data, nameKey, valueKey],
  );
  const visible = all.filter((d) => !hidden.has(d.key));
  const grand = all.reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0);
  const total = visible.reduce((sum, d) => sum + (Number.isFinite(d.value) ? d.value : 0), 0);
  const focused = hoverKey !== null ? (visible.find((d) => d.key === hoverKey) ?? null) : null;
  const share = (v: number) => (grand > 0 ? `%${Math.round((v / grand) * 100)}` : "");
  const items: ChartLegendItem[] = all.map((d) => ({ key: d.key, label: d.key, color: d.color, suffix: share(d.value) }));
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        <PlotBox>
          <ResponsiveContainer width="100%" height="100%" className="viz-depth">
            <PieChart>
              <Pie
                data={visible.map((d) => d.row)}
                dataKey={valueKey}
                nameKey={nameKey}
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={2}
                strokeWidth={0}
                shape={depthSector(tubeId, hoverKey, nameKey)}
                isAnimationActive={!reduce}
                animationDuration={DRAW_MS}
                animationEasing="ease-out"
                cursor={hrefKey ? "pointer" : undefined}
                onMouseEnter={(entry: unknown) => {
                  const e = entry as { name?: unknown; payload?: Row };
                  setHoverKey(String(e?.payload?.[nameKey] ?? e?.name ?? ""));
                }}
                onMouseLeave={() => setHoverKey(null)}
                onClick={
                  hrefKey
                    ? (entry: unknown) => {
                        const href = hrefOf(entry, hrefKey);
                        if (href) router.push(href);
                      }
                    : undefined
                }
              >
                {visible.map((d) => (
                  <Cell key={d.key} fill={d.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip format={format} hint={hint} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="max-w-[40%] text-center">
              <p className="numeric font-display text-xl font-extrabold tracking-[-0.02em] text-[color:var(--viz-tooltip-text)]">
                {formatChartValue(focused ? focused.value : total, format)}
              </p>
              <p className="truncate text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                {focused ? `${focused.key} · ${share(focused.value)}` : centerLabel}
              </p>
            </div>
          </div>
        </PlotBox>
      </div>
      <ChartLegend items={items} hidden={hidden} onToggle={toggle} onHover={setHoverKey} />
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
  /** Nokta tıklanınca gidilecek uygulama içi filtreli adres (sıfır çıkmaz metrik). */
  href?: string;
};

const TREND_TONE = {
  gold: "var(--viz-gold)",
  brand: "var(--viz-1)",
  success: "var(--viz-2)",
  violet: "var(--viz-4)",
} as const;

/**
 * AreaTrendChart — tek seri premium alan grafiği: altın (para) veya mavi çizgi, katmanlı degrade dolgu, çizgi
 * parlaması, SON gerçek noktada nabız noktası + değer etiketi, isteğe bağlı kesikli TAHMİN uzantısı (lejanttan gizlenir).
 * Zaman aralığı: >= 6 gerçek noktada altta sürüklenebilir mini harita, hazır aralık hapları ve canlı özet
 * (`summary`: "last" son değer + değişim, "total" aralık toplamı) çıkar; çift tık sıfırlar.
 * Dönem/filtre değişince `animationKey` ile yeniden çizilir (reduce'ta yok). `href` taşıyan noktaya tıklayınca oraya gidilir.
 * Ekran okuyucu için sr-only veri tablosu; ipucu ortak `ChartTooltip` (önceki döneme göre fark).
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
  rangeable,
  granularity = "month",
  summary = "last",
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
  /** Aralık seçici (varsayılan: >= 6 gerçek noktada açık). */
  rangeable?: boolean;
  granularity?: Granularity;
  summary?: RangeSummaryMode;
}) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const gid = useId().replace(/:/g, "");
  const color = TREND_TONE[tone];
  const fmt = (n: number) => (formatValue ? formatValue(n) : formatChartValue(n, format));
  const [hidden, toggle] = useHiddenSet();
  const allRows = useMemo(
    () => data.map((d) => ({ label: d.label, value: d.value, forecast: d.forecast ?? null, href: d.href })),
    [data],
  );
  const n = allRows.length;
  const realCount = useMemo(() => {
    let last = -1;
    allRows.forEach((d, i) => {
      if (d.value !== null && Number.isFinite(d.value)) last = i;
    });
    return last;
  }, [allRows]);
  const canRange = (rangeable ?? realCount + 1 >= 6) && n >= 4;
  const { range, setRange, reset, touched } = useChartRange(n);
  const reduce = reducedMotion || touched;
  const rows = useMemo(() => (canRange ? allRows.slice(range[0], range[1] + 1) : allRows), [canRange, allRows, range]);
  let lastIdx = -1;
  rows.forEach((d, i) => {
    if (d.value !== null && Number.isFinite(d.value)) lastIdx = i;
  });
  const hasForecast = allRows.some((d) => d.forecast !== null && d.forecast !== undefined);
  const showForecast = hasForecast && !hidden.has("forecast");
  const hasHref = allRows.some((d) => typeof d.href === "string");
  const labels = useMemo(() => allRows.map((r) => r.label), [allRows]);
  const allValues = useMemo(() => allRows.map((r) => r.value), [allRows]);

  const chart = (
    <ResponsiveContainer width="100%" height="100%" className="viz-depth">
      <AreaChart
        key={animationKey}
        data={rows}
        margin={{ top: showLastLabel ? 38 : 12, right: 14, left: 0, bottom: 0 }}
        style={hasHref ? { cursor: "pointer" } : undefined}
        onClick={
          hasHref
            ? (state: unknown) => {
                const idx = Number((state as { activeIndex?: unknown } | undefined)?.activeIndex);
                const href = Number.isInteger(idx) ? rows[idx]?.href : undefined;
                if (typeof href === "string" && href.startsWith("/")) router.push(href);
              }
            : undefined
        }
      >
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
        <Tooltip content={<ChartTooltip formatValue={fmt} deltaRows={allRows} hint={hasHref ? "Ayrıntı için tıklayın" : undefined} />} cursor={crosshair(color)} />
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
          dot={lastPointDot(color, lastIdx, fmt, showLastLabel)}
          activeDot={{ r: 6, strokeWidth: 2.5, stroke: "var(--surface-raised)", fill: color, className: "viz-dot" }}
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
        {showForecast ? (
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
  );

  return (
    <figure className="m-0 flex h-full min-h-0 flex-col gap-1" aria-label={ariaLabel}>
      <div className="min-h-0 flex-1">
        {canRange ? (
          <ChartRangePanel
            labels={labels}
            values={allValues}
            range={range}
            onRangeChange={setRange}
            onReset={reset}
            summaryMode={summary}
            formatValue={fmt}
            color={color}
            granularity={granularity}
            anchor={realCount}
            summaryLabel={name}
          >
            <PlotBox>{chart}</PlotBox>
          </ChartRangePanel>
        ) : (
          <div className="relative h-full">
            <PlotBox>{chart}</PlotBox>
          </div>
        )}
      </div>
      {hasForecast ? (
        <ChartLegend
          items={[
            { key: "value", label: name, color },
            { key: "forecast", label: forecastName, color, dashed: true },
          ]}
          hidden={hidden}
          onToggle={toggle}
        />
      ) : null}
      <table className="sr-only">
        <caption>{ariaLabel ?? name}</caption>
        <tbody>
          {allRows.map((r, i) => (
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
