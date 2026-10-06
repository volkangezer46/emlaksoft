"use client";

import { useEffect, useRef } from "react";

/**
 * Hero degradesinin oynatma anahtarı: üst `.ds-hero` ekranda VE sekme görünürken
 * `data-play="1"`, aksi halde kaldırılır (CSS `animation-play-state: paused`). Hareket
 * azaltmada CSS animasyonu hiç tanımlanmadığından bu bileşen etkisizdir. Görünmez öğe.
 */
export function HeroPlay() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const hero = ref.current?.closest<HTMLElement>(".ds-hero");
    if (!hero || typeof IntersectionObserver === "undefined") return;
    let visible = false;
    const apply = () => {
      if (visible && document.visibilityState === "visible") hero.dataset.play = "1";
      else delete hero.dataset.play;
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      apply();
    });
    io.observe(hero);
    document.addEventListener("visibilitychange", apply);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", apply);
      delete hero.dataset.play;
    };
  }, []);
  return <span ref={ref} hidden />;
}
