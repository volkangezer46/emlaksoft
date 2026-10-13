"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { EASE_OUT } from "./tokens";

const EASE = `cubic-bezier(${EASE_OUT.join(", ")})`;

/**
 * RiseIn — bağlanırken hafifçe yukarı kayarak belirir (sıralı `delay`, saniye). GrowBar — doluluk çubuğu 0'dan hedef
 * yüzdeye dolar, hedef değişince akar. Kütüphanesiz (CSS keyframes `rise-in` / `grow-from-zero`, motion.css; eski
 * motion/react sürümüyle aynı değerler: 320 ms / `duration` sn, cubic-bezier(0.22, 1, 0.36, 1)).
 *
 * Bağlanma anındaki tercih belirleyicidir (eski `initial` gibi): sunucu/hidrasyon anlık görüntüsü "azalt" olduğundan
 * sunucudan gelen öğe son karesiyle durur; yalnız istemcide sonradan bağlanan öğe girişi oynatır. Hareket azaltmada
 * süre 0 (keyframes yalnız `prefers-reduced-motion: no-preference` içinde tanımlıdır).
 */
export function RiseIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [animate] = useState(!reduce);
  const style: CSSProperties = animate
    ? { opacity: 1, transform: "none", animation: `rise-in 320ms ${EASE} ${delay}s backwards` }
    : { opacity: 1, transform: "none" };
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

export function GrowBar({ percent, className, duration = 0.7 }: { percent: number; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const [animate] = useState(!reduce);
  const pct = Math.min(100, Math.max(0, percent));
  const style: CSSProperties = { width: `${pct}%` };
  if (!reduce) style.transition = `width ${duration}s ${EASE}`;
  if (animate) style.animation = `grow-from-zero ${duration}s ${EASE}`;
  return <div className={className} style={style} />;
}
