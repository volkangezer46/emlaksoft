import Link from "@/components/ui/smart-link";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CHART_COLORS } from "@/components/ui/chart-colors";
import { formatChartAxis, formatChartValue, type ChartValueFormat } from "@/components/ui/chart-format";
import type { Granularity, RangeSummaryMode } from "@/components/ui/chart-range-math";
import { EmptyState } from "@/components/ui/empty-state";
import { axisLabelIndices, niceDomain } from "./scale";
import { DonutRing } from "./donut-ring";

/**
 * Sunucu grafikleri — `ui/lazy-charts` (Recharts) ile AYNI prop imzalı saf SVG/HTML sarmalayıcılar: `AreaTrend`,
 * `AreaTrendChart`, `BarCompare`, `DonutSplit`. İstemci JS'i ve Recharts parçası YOK; sık açılan sayfalar
 * (/admin, /admin/raporlar, /app/raporlar, /app/performansim, ana ekran gelir eğrisi) bunları kullanır, diğer
 * kullanımlar ve etkileşimli grafikler `lazy-charts`'ta kalır (içe aktarma yolunu değiştirmek yeter).
 *
 * - Değer görünürlüğü: her nokta/çubuk/dilim `<title>` taşır (üzerine gelince yerel ipucu); tek seride çubuk üstü
 *   etiket, alan grafiğinde son değer balonu; ekran okuyucu için sr-only veri tablosu.
 * - Sıfır çıkmaz metrik: `hrefKey` / nokta `href` verilirse çubuk/nokta filtreli hedefe giden bağlantıdır.
 * - Boş seri (veri yok ya da hepsi 0): sahte grafik çizilmez, anlamlı boş durum gösterilir.
 * - Renk yalnız token (`--viz-*`, `--text-muted`, `--surface`…): açık ve koyu temada aynı sözleşme.
 * - Hareket: çizgi bir kez soldan açılır, alan belirir (motion.css `.viz-reveal/.viz-fade`; reduce'ta durağan).
 * - Ölçek: viewBox 0..100 ve `preserveAspectRatio="none"`; çizgiler `non-scaling-stroke`, metin HTML'dir (bozulmaz).
 *
 * Aralık seçici (mini harita), lejanttan seri gizleme ve zengin ipucu yalnız Recharts sürümünde vardır.
 */

type Row = Record<string, string | number>;
type SeriesDef = { key: string; label: string; color?: string };

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

/** Grafik içinde dikey boşluk (viewBox yüzdesi): üstte balon/etiket payı, altta taban çizgisi payı. */
const PAD_TOP = 10;
const PAD_BOTTOM = 2;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (n: number) => `${n.toFixed(3)}%`;

/** Çubuk üstü kısa etiket (0'da boş): "₺18 bin", "%12", "1,2 Mn". */
function barLabel(v: number, format: ChartValueFormat): string {
  if (!Number.isFinite(v) || v === 0) return "";
  if (format === "percent") return `%${formatChartAxis(v, false)}`;
  return formatChartAxis(v, true, format === "money" ? "₺" : "");
}

function axisFormatter(format: ChartValueFormat, compact: boolean) {
  return (v: number) => {
    if (format === "percent") return `%${formatChartAxis(v, false)}`;
    return formatChartAxis(v, compact, format === "money" ? "₺" : "");
  };
}

function ChartEmpty({ text }: { text?: string }) {
  return (
    <div className="grid h-full min-h-28 place-items-center">
      <EmptyState
        variant="compact"
        illustration="rapor"
        title={text ?? "Bu aralıkta gösterilecek veri yok"}
        description="Kayıt oluştukça grafik burada çizilir."
      />
    </div>
  );
}

type LegendItem = { label: string; color: string; dashed?: boolean };

function Legend({ items, aside }: { items: readonly LegendItem[]; aside?: ReactNode }) {
  if (items.length === 0 && !aside) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-hidden="true">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="1" y1="3" x2="17" y2="3" stroke={it.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={it.dashed ? "4 3" : undefined} />
            </svg>
            {it.label}
          </li>
        ))}
      </ul>
      {aside ? <p className="tabular-nums">{aside}</p> : null}
    </div>
  );
}

/** Y ekseni etiketleri + yatay ızgara ile çizim alanı (sol 3 rem eksen sütunu). */
function PlotFrame({
  ticks,
  y,
  axis,
  xLabels,
  children,
  overlay,
}: {
  ticks: readonly number[];
  y: (v: number) => number;
  axis: (v: number) => string;
  /** Alt eksen: [konum %, metin, hizalama]. */
  xLabels: ReadonlyArray<{ x: number; text: string; width?: number }>;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-y-0 left-0 w-11" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[11px] leading-none tabular-nums text-text-muted" style={{ top: pct(y(t)) }}>
              {axis(t)}
            </span>
          ))}
        </div>
        <div className="absolute inset-y-0 left-12 right-1">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            {ticks.map((t) => (
              <line
                key={t}
                x1="0"
                x2="100"
                y1={y(t)}
                y2={y(t)}
                stroke="var(--viz-grid)"
                strokeWidth="1"
                strokeDasharray={t === 0 ? undefined : "2 5"}
                strokeOpacity={t === 0 ? 0.9 : 0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          {children}
          {overlay}
        </div>
      </div>
      <div className="relative ml-12 mr-1 h-5 shrink-0" aria-hidden="true">
        {xLabels.map((l, i) => {
          const edge = l.width === undefined ? (l.x <= 2 ? "left" : l.x >= 98 ? "right" : "center") : "center";
          return (
            <span
              key={i}
              className={cn(
                "absolute top-1 truncate text-[11px] leading-none text-text-muted",
                l.width !== undefined && "text-center",
                edge === "center" && "-translate-x-1/2",
                edge === "right" && "-translate-x-full",
              )}
              style={{ left: pct(l.x), width: l.width !== undefined ? pct(l.width) : undefined }}
            >
              {l.text}
            </span>
          );
        })}
      </div>
    </>
  );
}

type LineSeries = { name: string; color: string; values: ReadonlyArray<number | null>; dashed?: boolean; fill?: boolean };

/** Ortak çizgi/alan gövdesi (AreaTrend + AreaTrendChart). */
function LinePlot({
  labels,
  series,
  hrefs,
  fmt,
  axis,
  ariaLabel,
  showLastLabel,
  legend,
  summary,
  replayKey,
}: {
  labels: readonly string[];
  series: readonly LineSeries[];
  hrefs?: ReadonlyArray<string | undefined>;
  fmt: (v: number) => string;
  axis: (v: number) => string;
  ariaLabel: string;
  showLastLabel: boolean;
  legend: readonly LegendItem[];
  summary?: ReactNode;
  replayKey?: string | number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = labels.length;
  const all = series.flatMap((s) => s.values.map(finite).filter((v): v is number => v !== null));
  const ticks = niceDomain(Math.min(...all), Math.max(...all));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const y = (v: number) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * (100 - PAD_TOP - PAD_BOTTOM);
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const base = y(Math.max(lo, Math.min(0, hi)));

  const geo = series.map((s) => {
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let cur: Array<{ x: number; y: number }> = [];
    s.values.forEach((raw, i) => {
      const v = finite(raw);
      if (v === null) {
        if (cur.length) runs.push(cur);
        cur = [];
        return;
      }
      cur.push({ x: x(i), y: y(v) });
    });
    if (cur.length) runs.push(cur);
    const line = runs.map((r) => r.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")).join(" ");
    const area = runs
      .filter((r) => r.length > 1)
      .map((r) => `${r.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")} L${r[r.length - 1]!.x.toFixed(2)},${base.toFixed(2)} L${r[0]!.x.toFixed(2)},${base.toFixed(2)} Z`)
      .join(" ");
    let last = -1;
    s.values.forEach((v, i) => {
      if (finite(v) !== null) last = i;
    });
    return { s, line, area, last };
  });
  const lead = geo[0];
  const lastPoint = lead && lead.last >= 0 ? { i: lead.last, v: finite(lead.s.values[lead.last])! } : null;
  const step = n <= 1 ? 100 : 100 / (n - 1);
  const dotEvery = n <= 31;
  const clipId = `vz-clip-${uid}`;

  const titleAt = (i: number) =>
    `${labels[i] ?? ""}: ${series
      .map((s) => {
        const v = finite(s.values[i]);
        return v === null ? null : `${series.length > 1 ? `${s.name} ` : ""}${fmt(v)}`;
      })
      .filter(Boolean)
      .join(" · ")}`;

  const overlay =
    showLastLabel && lastPoint ? (
      <span
        className={cn(
          "pointer-events-none absolute -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-hairline bg-surface px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[color:var(--viz-tooltip-text)] shadow-[var(--elev-1)]",
          x(lastPoint.i) > 80 ? "-translate-x-full" : x(lastPoint.i) < 20 ? "" : "-translate-x-1/2",
        )}
        style={{ left: pct(x(lastPoint.i)), top: pct(y(lastPoint.v)) }}
        aria-hidden="true"
      >
        {fmt(lastPoint.v)}
      </span>
    ) : null;

  return (
    <figure key={replayKey} className="m-0 flex h-full min-h-40 flex-col gap-2">
      <Legend items={legend} aside={summary} />
      <PlotFrame
        ticks={ticks}
        y={y}
        axis={axis}
        xLabels={axisLabelIndices(n, n > 14 ? 5 : 6).map((i) => ({ x: x(i), text: labels[i] ?? "" }))}
        overlay={overlay}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={ariaLabel}>
          <defs>
            <clipPath id={clipId}>
              <rect x="-2" y="-10" width="104" height="120" className="viz-reveal" />
            </clipPath>
            {geo.map((g, i) => (
              <linearGradient key={i} id={`vz-ar-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={g.s.color} stopOpacity="0.34" />
                <stop offset="45%" stopColor={g.s.color} stopOpacity="0.13" />
                <stop offset="100%" stopColor={g.s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {geo.map((g, i) => (g.s.fill === false || !g.area ? null : <path key={`a${i}`} d={g.area} fill={`url(#vz-ar-${uid}-${i})`} className="viz-fade" />))}
          <g clipPath={`url(#${clipId})`}>
            {lead && !lead.s.dashed ? (
              <path d={lead.line} fill="none" stroke={lead.s.color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" style={{ strokeOpacity: "var(--viz-glow)" }} vectorEffect="non-scaling-stroke" />
            ) : null}
            {geo.map((g, i) => (
              <path
                key={`l${i}`}
                d={g.line}
                fill="none"
                stroke={g.s.color}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={g.s.dashed ? "6 5" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="viz-fade-late">
            {dotEvery
              ? geo.map((g, si) =>
                  g.s.dashed
                    ? null
                    : g.s.values.map((raw, i) => {
                        const v = finite(raw);
                        if (v === null || i === g.last) return null;
                        return <path key={`d${si}-${i}`} d={`M${x(i)},${y(v)} l0.001,0`} stroke={g.s.color} strokeWidth="4.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
                      }),
                )
              : null}
            {geo.map((g, si) => {
              const v = g.last >= 0 ? finite(g.s.values[g.last]) : null;
              if (v === null || g.s.dashed) return null;
              return (
                <g key={`last${si}`}>
                  <path d={`M${x(g.last)},${y(v)} l0.001,0`} stroke={g.s.color} strokeWidth="10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <path d={`M${x(g.last)},${y(v)} l0.001,0`} stroke="var(--surface)" strokeWidth="4.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </g>
          {/* Nokta başına görünmez bant: üzerine gelince <title> ile değer; href varsa filtreli hedefe bağlantı. */}
          {labels.map((_, i) => {
            const x0 = Math.max(0, x(i) - step / 2);
            const w = Math.min(100, x(i) + step / 2) - x0;
            const title = titleAt(i);
            const band = (
              <rect x={x0} y="0" width={w} height="100" fill="transparent" className="transition-[fill] hover:fill-[var(--viz-grid)]" fillOpacity="0.35">
                <title>{title}</title>
              </rect>
            );
            const href = hrefs?.[i];
            return href ? (
              <Link key={`h${i}`} href={href} aria-label={title}>
                {band}
              </Link>
            ) : (
              <g key={`h${i}`}>{band}</g>
            );
          })}
        </svg>
      </PlotFrame>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Dönem</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}>
              <th scope="row">{l}</th>
              {series.map((s) => {
                const v = finite(s.values[i]);
                return <td key={s.name}>{v === null ? "—" : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const PREV_LABEL: Record<Granularity, string> = { day: "önceki güne", week: "önceki haftaya", month: "önceki aya" };

/** Canlı özet metni (Recharts sürümündeki aralık özetinin sunucu karşılığı; tüm seri üzerinden). */
function summaryText(values: ReadonlyArray<number | null>, mode: RangeSummaryMode, granularity: Granularity, fmt: (v: number) => string): string | null {
  const real = values.map(finite).filter((v): v is number => v !== null);
  if (mode === "none" || real.length < 2) return null;
  if (mode === "total") return `Toplam ${fmt(real.reduce((a, v) => a + v, 0))}`;
  const last = real[real.length - 1]!;
  const prev = real[real.length - 2]!;
  if (prev === 0) return `Son ${fmt(last)}`;
  const change = Math.round(((last - prev) / Math.abs(prev)) * 100);
  return `Son ${fmt(last)} · ${PREV_LABEL[granularity]} göre ${change > 0 ? "+" : ""}%${change}`;
}

/**
 * AreaTrend (sunucu) — çok serili zaman serisi; ilk seri dolgulu + parlamalı, diğerleri çizgi. Lejant ve özet üstte.
 * Recharts sürümündeki aralık seçici yoktur; `rangeable`/`granularity` imza uyumu için alınır (özet metninde kullanılır).
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
  ariaLabel,
  emptyText,
}: {
  data: Row[];
  xKey: string;
  series: SeriesDef[];
  format?: ChartValueFormat;
  compactAxis?: boolean;
  rangeable?: boolean;
  granularity?: Granularity;
  summary?: RangeSummaryMode;
  ariaLabel?: string;
  emptyText?: string;
}) {
  const fmt = (v: number) => formatChartValue(v, format);
  const lines: LineSeries[] = series.map((s, i) => ({
    name: s.label,
    color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!,
    values: data.map((row) => finite(row[s.key])),
    fill: i === 0,
  }));
  const hasData = data.length >= 2 && lines.some((l) => l.values.some((v) => v !== null && v !== 0));
  if (!hasData) return <ChartEmpty text={emptyText} />;
  const showSummary = rangeable ?? data.length >= 8;
  return (
    <LinePlot
      labels={data.map((row) => String(row[xKey] ?? ""))}
      series={lines}
      fmt={fmt}
      axis={axisFormatter(format, compactAxis)}
      ariaLabel={ariaLabel ?? series.map((s) => s.label).join(", ")}
      showLastLabel={series.length === 1}
      legend={series.length > 1 ? lines.map((l) => ({ label: l.name, color: l.color })) : []}
      summary={showSummary ? summaryText(lines[0]!.values, summary, granularity, fmt) : null}
    />
  );
}

/**
 * AreaTrendChart (sunucu) — tek seri alan grafiği: altın (para) / mavi çizgi, katmanlı degrade, son gerçek noktada
 * değer balonu, isteğe bağlı kesikli TAHMİN uzantısı (lejantta). `href` taşıyan nokta tıklanabilir.
 * `animationKey` değişince (dönem/kapsam) çizim yeniden oynar.
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
  emptyText,
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
  rangeable?: boolean;
  granularity?: Granularity;
  summary?: RangeSummaryMode;
  emptyText?: string;
}) {
  const color = TREND_TONE[tone];
  const fmt = (n: number) => (formatValue ? formatValue(n) : formatChartValue(n, format));
  const values = data.map((d) => finite(d.value));
  const forecast = data.map((d) => finite(d.forecast ?? null));
  const hasForecast = forecast.some((v) => v !== null);
  const realCount = values.filter((v) => v !== null).length;
  if (realCount === 0 || values.every((v) => v === null || v === 0)) return <ChartEmpty text={emptyText} />;
  const lines: LineSeries[] = [{ name, color, values }];
  if (hasForecast) lines.push({ name: forecastName, color, values: forecast, dashed: true, fill: false });
  const showSummary = rangeable ?? realCount >= 6;
  return (
    <LinePlot
      replayKey={animationKey}
      labels={data.map((d) => d.label)}
      series={lines}
      hrefs={data.map((d) => d.href)}
      fmt={fmt}
      axis={axisFormatter(format, true)}
      ariaLabel={ariaLabel ?? name}
      showLastLabel={showLastLabel}
      legend={hasForecast ? [{ label: name, color }, { label: forecastName, color, dashed: true }] : []}
      summary={showSummary ? summaryText(values, summary, granularity, fmt) : null}
    />
  );
}

/**
 * BarCompare (sunucu) — kategori karşılaştırma. Dikey: gruplu sütunlar (negatif değer sıfırın altına), yatay: uzun
 * etiketli satırlar. Tek seride çubuk ucu kısa değer etiketi; `colorKey` satır başına renk (kâr/zarar).
 */
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
  ariaLabel,
  emptyText,
}: {
  data: Row[];
  xKey: string;
  series: SeriesDef[];
  format?: ChartValueFormat;
  colorKey?: string;
  layout?: "vertical" | "horizontal";
  hrefKey?: string;
  hint?: string;
  showValues?: boolean;
  ariaLabel?: string;
  emptyText?: string;
}) {
  const sheenId = `vz-sheen-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const fmt = (v: number) => formatChartValue(v, format);
  const cats = data.map((row) => String(row[xKey] ?? ""));
  const colorOf = (s: SeriesDef, si: number, row: Row) => {
    const own = colorKey && series.length === 1 ? row[colorKey] : undefined;
    return typeof own === "string" && own ? own : (s.color ?? CHART_COLORS[si % CHART_COLORS.length]!);
  };
  const val = (row: Row, s: SeriesDef) => finite(row[s.key]) ?? 0;
  const all = data.flatMap((row) => series.map((s) => val(row, s)));
  if (data.length === 0 || series.length === 0 || all.every((v) => v === 0)) return <ChartEmpty text={emptyText} />;
  const values = showValues ?? (series.length === 1 && data.length <= 10);
  const hrefOf = (row: Row) => {
    const h = hrefKey ? row[hrefKey] : undefined;
    return typeof h === "string" && h ? h : undefined;
  };
  const titleOf = (i: number, s: SeriesDef, v: number) => `${cats[i]}${series.length > 1 ? ` · ${s.label}` : ""}: ${fmt(v)}${hint ? ` — ${hint}` : ""}`;
  const rowLabel = (i: number, row: Row) => `${cats[i]}: ${series.map((s) => `${series.length > 1 ? `${s.label} ` : ""}${fmt(val(row, s))}`).join(", ")}`;
  const legend = series.length > 1 ? series.map((s, si) => ({ label: s.label, color: s.color ?? CHART_COLORS[si % CHART_COLORS.length]! })) : [];
  const ticks = niceDomain(Math.min(...all), Math.max(...all));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const summary = ariaLabel ?? `${series.map((s) => s.label).join(", ")} · ${data.map((row, i) => rowLabel(i, row)).join("; ")}`;

  if (layout === "horizontal") {
    const xh = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const zero = xh(0);
    return (
      <figure className="m-0 flex h-full flex-col gap-2" aria-label={summary}>
        <Legend items={legend} />
        <ul className="flex min-h-0 flex-1 flex-col justify-evenly gap-1">
          {data.map((row, i) => {
            const href = hrefOf(row);
            const body = (
              <>
                <span className="truncate text-sm text-text" title={cats[i]}>
                  {cats[i]}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  {series.map((s, si) => {
                    const v = val(row, s);
                    const a = Math.min(zero, xh(v));
                    const w = Math.abs(xh(v) - zero);
                    return (
                      <span key={s.key} className="flex min-w-0 items-center gap-2">
                        <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 min-w-0 flex-1 overflow-visible" aria-hidden="true">
                          <rect x="0" y="0" width="100" height="10" rx="0" fill="var(--surface-sunken)" />
                          <rect x={a} y="0" width={Math.max(w, v === 0 ? 0 : 0.6)} height="10" fill={colorOf(s, si, row)} className="viz-grow-x" style={{ transformBox: "fill-box" }}>
                            <title>{titleOf(i, s, v)}</title>
                          </rect>
                          <rect x={a} y="0" width={w} height="4" fill="var(--viz-sheen)" pointerEvents="none" />
                        </svg>
                        {values ? (
                          <span className="min-w-[4.5rem] text-right text-xs font-semibold tabular-nums text-text" aria-hidden="true">
                            {fmt(v)}
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              </>
            );
            const cls = "grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] items-center gap-3 rounded-[var(--radius-control)] px-1.5 py-1";
            return (
              <li key={`${cats[i]}-${i}`}>
                {href ? (
                  <Link href={href} aria-label={hint ? `${rowLabel(i, row)}. ${hint}` : rowLabel(i, row)} className={cn(cls, "focus-ring transition-colors hover:bg-[var(--surface-sunken)]")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls} role="img" aria-label={rowLabel(i, row)}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </figure>
    );
  }

  const y = (v: number) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * (100 - PAD_TOP - PAD_BOTTOM);
  const y0 = y(0);
  const n = data.length;
  const band = 100 / n;
  const groupW = band * (series.length > 1 ? 0.72 : 0.56);
  const barW = groupW / series.length;
  const bars = data.flatMap((row, i) =>
    series.map((s, si) => {
      const v = val(row, s);
      const bx = i * band + (band - groupW) / 2 + si * barW;
      return { i, s, si, v, x: bx, w: barW * (series.length > 1 ? 0.86 : 1), top: Math.min(y(v), y0), h: Math.abs(y(v) - y0), color: colorOf(s, si, row) };
    }),
  );
  const labelEvery = n > 12 ? Math.ceil(n / 12) : 1;
  const overlay = values
    ? bars.map((b) => {
        const text = barLabel(b.v, format);
        if (!text) return null;
        return (
          <span
            key={`v${b.i}-${b.si}`}
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold leading-none tabular-nums text-text",
              b.v >= 0 ? "-translate-y-[calc(100%+3px)]" : "translate-y-[3px]",
            )}
            style={{ left: pct(b.x + b.w / 2), top: pct(b.v >= 0 ? b.top : b.top + b.h) }}
            aria-hidden="true"
          >
            {text}
          </span>
        );
      })
    : null;

  return (
    <figure className="m-0 flex h-full min-h-36 flex-col gap-2">
      <Legend items={legend} />
      <PlotFrame
        ticks={ticks}
        y={y}
        axis={axisFormatter(format, true)}
        xLabels={cats.map((c, i) => ({ x: i * band, width: band, text: i % labelEvery === 0 ? c : "" }))}
        overlay={overlay}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={summary}>
          <defs>
            <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-sheen)" />
              <stop offset="70%" stopColor="var(--viz-sheen)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {data.map((row, i) => {
            const href = hrefOf(row);
            const groupBars = bars.filter((b) => b.i === i);
            const content = (
              <>
                {/* Kategori bandı: küçük çubukta da tıklanabilir/üzerine gelinebilir alan. */}
                <rect x={i * band} y="0" width={band} height="100" fill="transparent" className="transition-[fill] hover:fill-[var(--viz-grid)]" fillOpacity="0.3">
                  <title>{hint ? `${rowLabel(i, row)} — ${hint}` : rowLabel(i, row)}</title>
                </rect>
                {groupBars.map((b) =>
                  b.h > 0 ? (
                    <g key={b.si} className="viz-fade">
                      <rect x={b.x} y={b.top} width={b.w} height={b.h} fill={b.color}>
                        <title>{titleOf(b.i, b.s, b.v)}</title>
                      </rect>
                      <rect x={b.x} y={b.top} width={b.w} height={b.h} fill={`url(#${sheenId})`} pointerEvents="none" />
                      <rect x={b.x + b.w * 0.84} y={b.top} width={b.w * 0.16} height={b.h} fill="var(--viz-shade)" pointerEvents="none" />
                    </g>
                  ) : null,
                )}
              </>
            );
            return href ? (
              <Link key={i} href={href} aria-label={hint ? `${rowLabel(i, row)}. ${hint}` : rowLabel(i, row)}>
                {content}
              </Link>
            ) : (
              <g key={i}>{content}</g>
            );
          })}
        </svg>
      </PlotFrame>
    </figure>
  );
}

/**
 * DonutSplit (sunucu) — dağılım halkası (`DonutRing`) + değer/yüzde lejantı. Dilim `<title>` ile değer verir;
 * `hrefKey` verilirse dilim ve lejant satırı filtreli hedefe gider (klavye yolu lejanttır).
 */
export function DonutSplit({
  data,
  nameKey = "name",
  valueKey = "value",
  format = "number",
  centerLabel,
  hrefKey,
  hint,
  emptyText,
}: {
  data: Row[];
  nameKey?: string;
  valueKey?: string;
  format?: ChartValueFormat;
  centerLabel?: string;
  hrefKey?: string;
  hint?: string;
  emptyText?: string;
}) {
  const fmt = (v: number) => formatChartValue(v, format);
  const items = data.map((row, i) => {
    const value = Math.max(0, finite(row[valueKey]) ?? 0);
    const h = hrefKey ? row[hrefKey] : undefined;
    return { label: String(row[nameKey] ?? ""), value, color: CHART_COLORS[i % CHART_COLORS.length]!, href: typeof h === "string" && h ? h : undefined };
  });
  const total = items.reduce((a, it) => a + it.value, 0);
  if (!(total > 0)) return <ChartEmpty text={emptyText} />;
  const share = (v: number) => Math.round((v / total) * 100);
  const titleOf = (it: (typeof items)[number]) => `${it.label}: ${fmt(it.value)} (%${share(it.value)})${hint ? ` — ${hint}` : ""}`;
  return (
    <div className="flex h-full flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <DonutRing
        segments={items.map((it) => ({ label: it.label, value: it.value, color: it.color, href: it.href, title: titleOf(it) }))}
        format={format}
        ariaLabel={centerLabel ?? "Dağılım"}
      >
        <span className="flex flex-col items-center">
          <span className="text-lg font-bold tabular-nums text-text">{fmt(total)}</span>
          {centerLabel ? <span className="text-xs text-text-muted">{centerLabel}</span> : null}
        </span>
      </DonutRing>
      <ul className="flex min-w-0 flex-col gap-1 text-sm">
        {items.map((it) => {
          const body = (
            <>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              <span className="tabular-nums font-semibold text-text">{fmt(it.value)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-text-muted">%{share(it.value)}</span>
            </>
          );
          const cls = "flex items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-0.5";
          return (
            <li key={it.label}>
              {it.href ? (
                <Link href={it.href} title={titleOf(it)} className={cn(cls, "focus-ring hover:bg-[var(--surface-sunken)]")}>
                  {body}
                </Link>
              ) : (
                <span className={cls} title={titleOf(it)}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
