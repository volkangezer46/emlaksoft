"use client";

import dynamic from "next/dynamic";

/**
 * Admin layout canlı veri adacığı — tembel sarmalayıcı (görsel çıktısı yok). Kanal çekirdeği (`hooks/use-admin-realtime`,
 * realtime yardımcıları, tazeleme zamanlayıcısı) /admin rotalarının ilk yük JS'inden çıkar; bağlantı zaten boşta
 * kuruluyordu. Zil ve talep eylemleri köprüyü (`lib/admin-realtime-bridge`) okur.
 */
export const AdminRealtime = dynamic(() => import("./admin-realtime-live").then((m) => m.AdminRealtime), {
  ssr: false,
  loading: () => null,
});
