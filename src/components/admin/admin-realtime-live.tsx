"use client";

import { useAdminRealtime } from "@/hooks/use-admin-realtime";

/**
 * Admin layout canlı veri adacığı (görsel çıktısı yok): personel özel Broadcast konularına katılır, açık rotayı
 * ilgilendiren değişiklikte sayfayı 2 sn'de birleşik tazeler, zil bildirimini anında iletir. Kurallar
 * `src/hooks/use-admin-realtime.ts`'te.
 */
export function AdminRealtime({ staffId }: { staffId: string }) {
  useAdminRealtime(staffId);
  return null;
}
