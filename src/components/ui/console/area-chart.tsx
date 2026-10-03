import { cn } from "@/lib/utils";

export type ChartPoint = { label: string; value: number };

const W = 600;
const H = 168;
const PAD_T = 14;
const PAD_B = 8;

/**
 * Alan grafiği (saf SVG, sunucu bileşeni). Yalnız GERÇEK seri için çağır: <2 nokta
 * ise `null` döner, çağıran anlamlı boş durum gösterir (seri yoksa grafik yok).
 * Erişilebilirlik: role="img" + özet etiketi + sr-only veri tablosu.
 */
export function AreaChart({
  data,
  id,
  ariaLabel,
  format = (n) => String(n),
  tone = "accent",
  className,
}: {
  data: readonly ChartPoint[];
  /** Gradient kimliği (sayfada benzersiz). */
  id: string;
  ariaLabel: string;
  format?: (n: number) => string;
  tone?: "accent" | "gold";
  className?: string;
}) {
  if (data.length < 2) return null;
  const color = tone === "gold" ? "var(--gold-500)" : "var(--accent)";
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const last = data[data.length - 1]!;
  const lastX = x(data.length - 1);
  const lastY = y(last.value);
  const grid = [0.25, 0.5, 0.75].map((f) => PAD_T + f * (H - PAD_T - PAD_B));
  const mid = data[Math.floor((data.length - 1) / 2)]!;

  return (
    <figure className={cn("m-0", className)}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.26" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((gy) => (
            <line key={gy} x1="0" x2={W} y1={gy} y2={gy} stroke="var(--hairline)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          ))}
          <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={`url(#${id})`} />
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <circle cx={lastX} cy={lastY} r="7" fill={color} opacity="0.18" />
          <circle cx={lastX} cy={lastY} r="3.5" fill="var(--surface)" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <span
          className="num pointer-events-none absolute -translate-y-full rounded-md border border-hairline bg-surface px-1.5 py-0.5 text-xs text-text shadow-[var(--elev-1)]"
          style={{ right: 0, top: `${(lastY / H) * 100}%` }}
          aria-hidden="true"
        >
          {format(last.value)}
        </span>
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-text-faint" aria-hidden="true">
        <span>{data[0]!.label}</span>
        <span>{mid.label}</span>
        <span>{last.label}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
