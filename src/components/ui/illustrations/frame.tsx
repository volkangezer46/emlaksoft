import type { ReactNode } from "react";

/**
 * İllüstrasyon çerçevesi — 132x92 viewBox, dekoratif (aria-hidden).
 * Renk: `currentColor` (ton sınıfı) + yüzey token'ları; koyu temada token'lar
 * kendiliğinden uyar. Hareket `src/app/motion.css` (.ill-*) içindedir ve
 * yalnız transform/opacity/stroke-dashoffset kullanır; reduced-motion'da durağandır.
 */
export type IllustrationTone = "brand" | "mint" | "amber" | "danger";

const TONE: Record<IllustrationTone, string> = {
  brand: "text-brand-600",
  mint: "text-mint-500",
  amber: "text-amber-500",
  danger: "text-danger-500",
};

export function IllustrationFrame({
  tone = "brand",
  size = 132,
  className = "",
  children,
}: {
  tone?: IllustrationTone;
  size?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={Math.round((size * 92) / 132)}
      viewBox="0 0 132 92"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`ill mx-auto ${TONE[tone]} ${className}`}
    >
      <ellipse cx="66" cy="84" rx="42" ry="4" fill="currentColor" stroke="none" opacity="0.08" />
      {children}
    </svg>
  );
}

/** Ortak boyalar (token). */
export const SOFT = "var(--surface-sunken)";
export const LINE = "var(--line-strong)";
export const TINT = "color-mix(in srgb, currentColor 18%, transparent)";
