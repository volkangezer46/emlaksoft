import type { CSSProperties } from "react";
import styles from "./celebrate.module.css";

const COLORS = ["#14b87a", "#f5a623", "#4f7cff", "#e5484d", "#9b5de5", "#14b87a", "#f5a623", "#4f7cff"];

/** Sabit (rastgelesiz, saf) konfeti yönleri: 8 nokta, dairesel dağılım. */
const DOTS = COLORS.map((color, i) => {
  const angle = (i / COLORS.length) * Math.PI * 2;
  const r = 42;
  return {
    color,
    x: `${Math.round(Math.cos(angle) * r)}px`,
    y: `${Math.round(Math.sin(angle) * r)}px`,
    delay: `${360 + (i % 4) * 40}ms`,
  };
});

/**
 * Başarı tiki + küçük konfeti patlaması (kutlama). Saf CSS; prefers-reduced-motion'da
 * hareketsiz tik gösterir. `tone="neutral"` kayıp gibi kutlanmayacak sonuçlarda konfetisiz kullanılır.
 */
export function Celebrate({ tone = "success", label }: { tone?: "success" | "neutral"; label?: string }) {
  return (
    <span className={styles.wrap} role="img" aria-label={label ?? "Tamamlandı"}>
      {tone === "success"
        ? DOTS.map((d, i) => (
            <span
              key={i}
              className={styles.dot}
              style={{ "--c": d.color, "--x": d.x, "--y": d.y, "--d": d.delay } as CSSProperties}
            />
          ))
        : null}
      <span className={styles.disc} data-tone={tone === "neutral" ? "danger" : "success"}>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path className={styles.tick} d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </span>
  );
}
