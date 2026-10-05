"use client";

import { useSyncExternalStore } from "react";

/**
 * Hareket azaltma tercihi (prefers-reduced-motion: reduce).
 * Sunucu/hidrasyon anlık görüntüsü "azalt" (animasyonsuz) → hidrasyon sonrası gerçek tercih
 * (animated-number.tsx deseni). Recharts'ın JS ile yürüttüğü giriş animasyonu CSS kuralıyla
 * kapanmadığı için `isAnimationActive={!reduce}` ile bu kanca kullanılır.
 */
const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE).matches,
    () => true,
  );
}
