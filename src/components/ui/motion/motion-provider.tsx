"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";

/** Özellikler ayrı parçada: ilk etkileşimden önce arka planda iner (`strict`: tam `motion` bileşeni yasak). */
export const loadMotionFeatures = () => import("./features").then((mod) => mod.default);

/**
 * MotionProvider — `LazyMotion` (+ `MotionConfig reducedMotion="user"`). Hareket adacıkları
 * (Reveal, Stagger, FadeSwap) bunu kendileri sarar; birden çok adacığı tek bağlamda toplamak
 * için sayfa düzeyinde de kullanılabilir. `strict`: yanlışlıkla tam `motion.div` (34 KB)
 * içe aktarılırsa geliştirmede hata verir; yalnız `m.*` kullanılır.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
