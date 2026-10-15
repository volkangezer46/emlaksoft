"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

/**
 * İlan Kontrol ekranı sayaçlarının CANLI güncellenmesi. Kaynak: `listing_control_events` (append-only; migration
 * 20260826002800). SK2 (2026-10-16): olay ofis konusundan (`tenant:<ofis>`, deyim düzeyinde Broadcast,
 * 20261016020000) gelir; sayfadaki TEK kanal layout'la paylaşılır ve olay tablo adına göre süzülür. Konu yalnız kimlik
 * taşır (kişisel veri yok); satır görünürlüğü (portals/view + `lc_row_visible` rol kapsamı) tazelemede sunucu
 * sorgusunun RLS'iyle uygulanır. Olay gelince sayfa `router.refresh()` ile yeniden okunur (arka plandaki sekmede
 * bekler, iki yenileme arası >= 2 sn, olaylar birleştirilir; layout kancasıyla ortak zamanlayıcı: aynı anda tek
 * tazeleme). Bağlantı koparsa geri çekilmeyle yeniden bağlanılır; hata yüzeye çıkmaz.
 */
export function ControlLiveRefresh({ tenantId }: { tenantId: string | null }) {
  useRealtimeRefresh({ tenantId, tables: ["listing_control_events"], debounceMs: 400 });
  return null;
}
