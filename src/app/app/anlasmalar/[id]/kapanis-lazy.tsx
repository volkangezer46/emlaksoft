"use client";

import dynamic from "next/dynamic";
import type { KapanisProps } from "./kapanis-sihirbazi";

/**
 * Kapanış sihirbazı yalnız "Kapanış" sekmesinde gerekir: anlaşma detayının ilk yük JS'ine girmesin diye ayrı parça
 * (HIZ ANA İLKESİ: ağır istemci parçası `next/dynamic`). Yüklenirken kart iskeleti.
 */
const KapanisSihirbazi = dynamic(() => import("./kapanis-sihirbazi").then((m) => m.KapanisSihirbazi), {
  loading: () => <div aria-busy="true" aria-label="Kapanış sihirbazı yükleniyor" className="surface-card h-72 animate-pulse rounded-[var(--radius-panel)] motion-reduce:animate-none" />,
});

export function KapanisLazy(props: KapanisProps) {
  return <KapanisSihirbazi {...props} />;
}
