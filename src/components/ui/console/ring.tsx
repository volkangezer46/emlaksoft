import type { ReactNode } from "react";

/**
 * Halka ilerleme (saf SVG). `value`/`max` gerçek sayılar olmalı; max<=0 ise null
 * (sahte yüzde yok). Ortadaki içerik `children`.
 */
export function Ring({
  value,
  max,
  size = 88,
  stroke = 9,
  tone = "accent",
  ariaLabel,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  tone?: "accent" | "gold" | "success";
  ariaLabel: string;
  children?: ReactNode;
}) {
  if (!(max > 0)) return null;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = Math.min(1, Math.max(0, value / max));
  const color = tone === "gold" ? "var(--gold-500)" : tone === "success" ? "var(--mint-500)" : "var(--accent)";
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hairline)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * ratio).toFixed(2)} ${c.toFixed(2)}`}
        />
      </svg>
      {children ? <div className="absolute inset-0 grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}
