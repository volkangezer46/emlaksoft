"use client";

import dynamic from "next/dynamic";

/**
 * PWA yardımcısı — tembel sarmalayıcı. Görünmez adacık (kartlar zaten koşula bağlı, oturum sayımı boşta): kodu ve
 * push yardımcıları (`pwa-assist-live.tsx`, `lib/push-client`) /app rotalarının ilk yük JS'inden çıkar.
 */
export const PwaAssist = dynamic(() => import("./pwa-assist-live").then((m) => m.PwaAssist), {
  ssr: false,
  loading: () => null,
});
