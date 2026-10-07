import Link from "@/components/ui/smart-link";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "./colors";

/**
 * AreaChart (viz) — premium ve console alan grafiklerinin birleşimi. Saf SVG, sunucu
 * bileşeni, yeni bağımlılık yok. Yalnız GERÇEK seriyle çizilir: kullanılabilir (>=2 sonlu
 * nokta) seri yoksa `null` döner, çağıran/ChartCard anlamlı boş durum gösterir.
 *
 * - Tek veya çift seri, ortak ölçek (sıfırdan en büyük değere). İkinci seri kesikli çizgidir:
 *   seri ayrımı yalnız renge bağlı değildir.
 * - Derinlik (viz.css token'ları): katmanlı (3 duraklı) degrade dolgu + çizginin altında kalın, yarı saydam parlama
 *   çizgisi (SVG filtresi yok).
 * - Hareket: ilk görünümde çizgi soldan açılır (clipPath), alan yumuşakça belirir; bir kez.
 *   reduced-motion'da hareket sınıfları oynamaz → bitiş durumu (motion.css).
 * - Erişilebilirlik: role="img" + özet etiket + sr-only veri tablosu. `href` verilirse
 *   tüm grafik filtrelenmiş hedefe giden bir bağlantıdır.
 */
export type VizAreaSeries = {
  name: string;
  values: readonly number[];
  tone?: VizTone;
  /** Ham CSS rengi; verilirse tone'u ezer. Token kullan (ör. "var(--viz-3)"). */
  color?: string;
};

const W = 600;
const H = 160;
const PAD_T = 14;
const PAD_B = 8;
const GRID = [0.25, 0.5, 0.75, 1];

export function AreaChart({
  series,
  pointLabels,
  axisLabels,
  height = 176,
  format = "number",
  formatValue,
  ariaLabel,
  href,
  hrefLabel,
  showLast,
  className,
}: {
  series: readonly VizAreaSeries[];
  /** Nokta başına etiket (sr-only tablo + ilk/orta/son eksen varsayılanı). */
  pointLabels?: readonly string[];
  /** Altta gösterilen eksen etiketleri (verilmezse pointLabels'ın ilk/orta/sonu). */
  axisLabels?: readonly string[];
  height?: number;
  format?: VizFormat;
  /** Özel değer biçimleyici (verilirse `format`ı ezer). */
  formatValue?: (n: number) => string;
  ariaLabel?: string;
  href?: string;
  hrefLabel?: string;
  /** Tek seride son değer balonu (varsayılan: tek seride açık). */
  showLast?: boolean;
  className?: string;
}) {
  const fmt = formatValue ?? ((v: number) => formatViz(v, format));
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const usable = series.filter((s) => s.values.length >= 2 && s.values.every((v) => Number.isFinite(v)));
  if (usable.length === 0) return null;
  const all = usable.flatMap((s) => [...s.values]);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  if (all.every((v) => v === 0)) return null;

  const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
  const geo = usable.map((s, i) => {
    const n = s.values.length;
    const pts = s.values.map((v, k) => ({ x: (k / (n - 1)) * W, y: y(v) }));
    const line = pts.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return { s, color: s.color ?? vizToneColor(s.tone, i), line, area: `${line} L${W},${H} L0,${H} Z`, last: pts[n - 1]! };
  });

  const n0 = usable[0]!.values.length;
  const labels = pointLabels && pointLabels.length === n0 ? pointLabels : undefined;
  const ticks = axisLabels ?? (labels ? [labels[0]!, labels[Math.floor((n0 - 1) / 2)]!, labels[n0 - 1]!] : undefined);
  const summary =
    ariaLabel ??
    usable
      .map((s) => `${s.name}: ${fmt(s.values[0]!)} → ${fmt(s.values[s.values.length - 1]!)}`)
      .join(" · ");
  const lastBadge = (showLast ?? usable.length === 1) ? geo[0] : null;
  const clipId = `viz-clip-${uid}`;

  const body = (
    <figure className={cn("m-0", className)}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="none" className="block w-full overflow-visible" style={{ height }}>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="-8" width={W} height={H + 16} className="viz-reveal" />
            </clipPath>
            {geo.map((g, i) => (
              <linearGradient key={i} id={`viz-ar-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={g.color} stopOpacity="0.3" />
                <stop offset="45%" stopColor={g.color} stopOpacity="0.12" />
                <stop offset="100%" stopColor={g.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {GRID.map((s) => {
            const gy = PAD_T + (1 - s) * (H - PAD_T - PAD_B);
            return (
              <line key={s} x1="0" x2={W} y1={gy} y2={gy} stroke="var(--viz-grid)" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            );
          })}
          {geo.map((g, i) => (
            <path key={`a${i}`} d={g.area} fill={`url(#viz-ar-${uid}-${i})`} className="viz-fade" />
          ))}
          <g clipPath={`url(#${clipId})`}>
            {geo.map((g, i) =>
              i === 0 ? (
                <path
                  key={`gl${i}`}
                  d={g.line}
                  fill="none"
                  stroke={g.color}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ strokeOpacity: "var(--viz-glow)" }}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
            {geo.map((g, i) => (
              <path
                key={`l${i}`}
                d={g.line}
                fill="none"
                stroke={g.color}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={i === 0 ? undefined : "6 4"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {geo.map((g, i) => (
            <g key={`p${i}`} className="viz-fade-late">
              <path d={`M${g.last.x},${g.last.y} l0.001,0`} stroke={g.color} strokeWidth="9" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path d={`M${g.last.x},${g.last.y} l0.001,0`} stroke="var(--surface)" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {lastBadge ? (
          <span
            className="pointer-events-none absolute right-0 -translate-y-full rounded-md border border-hairline bg-surface px-1.5 py-0.5 text-xs font-semibold tabular-nums text-[color:var(--viz-tooltip-text)] shadow-[var(--elev-1)]"
            style={{ top: `${(lastBadge.last.y / H) * 100}%` }}
            aria-hidden="true"
          >
            {fmt(lastBadge.s.values[lastBadge.s.values.length - 1]!)}
          </span>
        ) : null}
      </div>
      {ticks && ticks.length > 0 ? (
        <figcaption className="mt-2 flex justify-between text-xs text-text-muted" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </figcaption>
      ) : null}
      {usable.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted" aria-hidden="true">
          {geo.map((g, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="18" y2="3" stroke={g.color} strokeWidth="2.25" strokeLinecap="round" strokeDasharray={i === 0 ? undefined : "5 3"} />
              </svg>
              {g.s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Dönem</th>
            {usable.map((s, i) => (
              <th key={i} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n0 }, (_, k) => (
            <tr key={k}>
              <th scope="row">{labels ? labels[k] : `${k + 1}. nokta`}</th>
              {usable.map((s, i) => (
                <td key={i}>{k < s.values.length ? fmt(s.values[k]!) : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );

  if (!href) return body;
  return (
    <Link href={href} aria-label={hrefLabel} className="block rounded-[var(--radius-control)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
      {body}
    </Link>
  );
}
