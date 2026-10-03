import { cn } from "@/lib/utils";
import { barsGeometry, summarizeSeries, type PremiumTone } from "./premium-math";

/**
 * MiniBars — saf SVG mini çubuk grafiği (sunucu bileşeni). GERÇEK seri yoksa
 * (en az 2 sonlu nokta) hiçbir şey çizmez. Son çubuk tam renk, öncekiler yumuşak.
 * `onDark`: hero/cam kutu içinde (altın tonu, açık zemin renkleri).
 */
export function MiniBars({
  data,
  tone = "brand",
  label,
  unit,
  width = 64,
  height = 32,
  onDark = false,
  fluid = false,
  className,
}: {
  data: readonly number[] | undefined | null;
  tone?: PremiumTone;
  label?: string;
  unit?: string;
  width?: number;
  height?: number;
  onDark?: boolean;
  /** Genişliği kapsayıcıya yay (yükseklik sabit). */
  fluid?: boolean;
  className?: string;
}) {
  const bars = barsGeometry(data, { width, height, gap: 2.5 });
  if (!bars) return null;
  const solid = onDark ? "#f0c36a" : "var(--t)";
  return (
    <svg
      role="img"
      aria-label={label ?? summarizeSeries(data, unit)}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(`pm-t-${tone} block shrink-0`, className)}
      style={{ width: fluid ? "100%" : width, height }}
      preserveAspectRatio={fluid ? "none" : undefined}
    >
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={Math.min(1.5, b.w / 2)}
          fill={solid}
          opacity={b.last ? 1 : onDark ? 0.5 : 0.38}
        />
      ))}
    </svg>
  );
}
