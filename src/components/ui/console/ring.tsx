import type { ReactNode } from "react";
import { RadialGauge } from "../viz/radial-gauge";

/**
 * Halka ilerleme — viz `RadialGauge`'e yönlenen sarmalayıcı (eski dışa aktarım korunur).
 * `value`/`max` gerçek sayılar olmalı; max<=0 ise null (sahte yüzde yok). Ortadaki içerik `children`.
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
  return (
    <RadialGauge
      value={value}
      max={max}
      size={size}
      stroke={stroke}
      color={tone === "gold" ? "var(--gold-500)" : tone === "success" ? "var(--viz-pos)" : "var(--accent)"}
      ariaLabel={ariaLabel}
    >
      {children}
    </RadialGauge>
  );
}
