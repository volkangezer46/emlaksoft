"use client";

import { useState, type ReactNode } from "react";

/**
 * FadeSwap — filtre/dönem değişince yeni içerik yumuşakça gelir (220 ms, opacity + 4 px).
 * `swapKey` ilk değerinden farklıysa içerik anahtarla yeniden bağlanır ve motion.css
 * `.motion-swap` giriş animasyonu bir kez oynar; ilk boyamada animasyon YOK (sunucu çıktısı
 * aynen görünür). Hareket azaltmada animasyon tanımlı değildir (CSS no-preference bloğu).
 *
 * Neden motion/AnimatePresence değil: çıkış animasyonu için ilk yük JS'ine ~10 KB ekliyordu
 * (ölçüm 2026-10-06); giriş geçişi aynı algıyı 0 KB ile verir. Arama parametresi değişimi
 * sayfayı yeniden BAĞLAMAZ (Next template belgesi), bu yüzden `?donem=` gibi filtrelerde çalışır.
 */
export function FadeSwap({ swapKey, children, className }: { swapKey: string | number; children: ReactNode; className?: string }) {
  const [firstKey] = useState(swapKey);
  const changed = swapKey !== firstKey;
  return (
    <div key={swapKey} className={[changed ? "motion-swap" : "", className ?? ""].filter(Boolean).join(" ") || undefined}>
      {children}
    </div>
  );
}
