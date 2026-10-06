"use client";

import type { ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { MotionProvider } from "./motion-provider";
import { EASE_OUT, MOTION_MS, seconds } from "./tokens";

/**
 * FadeSwap — filtre/dönem değişince içerik yumuşakça yer değiştirir (eski 150 ms'de çekilir,
 * yeni 220 ms'de 4 px yükselerek gelir). `swapKey` değişmedikçe hiçbir şey oynamaz; ilk
 * boyamada animasyon yok (sunucu çıktısı aynen görünür). Hareket azaltmada süre 0 (ağaç aynı
 * kalır; hidrasyon sonrası yeniden bağlanma olmaz).
 *
 * Arama parametresi değişimi sayfayı yeniden BAĞLAMAZ (Next template belgesi), bu yüzden
 * `?donem=` gibi URL filtrelerinde çalışır. Sunucu bileşeni çocuk alabilir.
 */
export function FadeSwap({ swapKey, children, className }: { swapKey: string | number; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <MotionProvider>
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={swapKey}
          className={className}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { duration: seconds(MOTION_MS.base), ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: reduce ? { duration: 0 } : { duration: seconds(MOTION_MS.exitBase), ease: EASE_OUT } }}
        >
          {children}
        </m.div>
      </AnimatePresence>
    </MotionProvider>
  );
}
