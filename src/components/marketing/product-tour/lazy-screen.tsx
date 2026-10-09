"use client";

import { useEffect, useState, type ComponentType } from "react";
import { runWhenIdle } from "@/lib/idle";
import type { TourItem } from "@/lib/site-content/schema";

/**
 * Ürün turunun GÖRÜNMEYEN sekme ekranları (2..N) HTML ve RSC yüküne girmez: boyama ve etkileşim bittikten sonra
 * (boşta) ayrı parça olarak yüklenir. Ekran seçilince henüz gelmediyse aynı oranda sakin bir yer tutucu görünür
 * (yerleşim kayması yok). Etkin ilk ekran sunucuda çizilir; başlık, açıklama ve madde metinleri her sekme için HTML'de kalır.
 */
export function LazyTourScreen({ id }: { id: TourItem["id"] }) {
  const [Screen, setScreen] = useState<ComponentType | null>(null);

  useEffect(() => {
    let live = true;
    const cancel = runWhenIdle(() => {
      import("./screens-client")
        .then((m) => {
          if (live) setScreen(() => m.CLIENT_SCREENS[id]);
        })
        .catch(() => {});
    });
    return () => {
      live = false;
      cancel();
    };
  }, [id]);

  if (Screen) return <Screen />;
  return <div className="mk-svg mk-svg-ph" aria-hidden="true" />;
}
