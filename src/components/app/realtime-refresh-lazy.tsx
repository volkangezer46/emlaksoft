"use client";

import dynamic from "next/dynamic";

/**
 * RealtimeRefresh tembel sarmalayıcısı: hiçbir şey çizmeyen canlı tazeleme bileşeni ve onunla gelen realtime çekirdeği
 * (konu hub'ı, rota/tablo eşlemesi, tazeleme zamanlayıcısı; ~55 KB kaynak) her /app rotasının ilk yük JS'inden çıkar.
 * Bağlantı zaten boşta kuruluyordu (loadRealtimeClient → runWhenIdle); parça hidrasyondan hemen sonra iner.
 */
export const RealtimeRefreshLazy = dynamic(() => import("./realtime-refresh").then((m) => m.RealtimeRefresh), {
  ssr: false,
  loading: () => null,
});
