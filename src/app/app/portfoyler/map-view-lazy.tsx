"use client";

import dynamic from "next/dynamic";

/**
 * Harita ağır bir client komponenti ve yalnız ?gorunum=harita'da görünür. `dynamic()` İSTEMCİ dosyasında olmalı:
 * sunucu bileşenindeki `dynamic()` istemci parçasını ayırmaz (harita liste görünümünün ilk yük paketine giriyordu).
 * Yükleme iskeleti ve sunucu çıktısı aynıdır.
 */
export const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  loading: () => <div className="h-[520px] animate-pulse rounded-[var(--radius-panel)] border border-line bg-ink-950/8" />,
});
