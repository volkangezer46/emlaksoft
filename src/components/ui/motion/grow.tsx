"use client";

import type { ReactNode } from "react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { MotionProvider } from "./motion-provider";
import { EASE_OUT } from "./tokens";

/**
 * RiseIn — bağlanırken hafifçe yukarı kayarak belirir (sıralı `delay`). GrowBar — doluluk çubuğu 0'dan hedef yüzdeye dolar,
 * hedef değişince akar. İkisi de hareket azaltmada anında (süre 0, başlangıç yok). `m.*` + LazyMotion (MotionProvider).
 */
export function RiseIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <MotionProvider>
      <m.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.32, delay: reduce ? 0 : delay, ease: EASE_OUT }}
        className={className}
      >
        {children}
      </m.div>
    </MotionProvider>
  );
}

export function GrowBar({ percent, className, duration = 0.7 }: { percent: number; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <MotionProvider>
      <m.div
        className={className}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0 : duration, ease: EASE_OUT }}
      />
    </MotionProvider>
  );
}
