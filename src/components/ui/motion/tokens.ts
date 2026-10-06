/**
 * Hareket token'larının TS karşılığı (motion/react geçişleri için). Değerler
 * `src/app/motion.css` ile BİREBİR aynıdır; sözleşme testi (`motion-layer.test.ts`)
 * iki kaynağı karşılaştırır. Süreyi bileşende sabit yazma, buradan al.
 */
export const MOTION_MS = {
  fast: 140,
  base: 220,
  slow: 320,
  exitBase: 150,
  stagger: 40,
  draw: 600,
} as const;

/** `--ease-out` = cubic-bezier(0.22, 1, 0.36, 1) */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Görünürlükte giriş: en çok bu kadar öğe kademelenir (bütçe: liste stagger ≤ 12). */
export const STAGGER_MAX = 12;

export const seconds = (ms: number) => ms / 1000;
