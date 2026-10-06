"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

/**
 * İlan Kontrol ana ekranı sayaçlarının CANLI güncellenmesi. Tek kanal, tek tablo: `listing_control_events`
 * (append-only; migration 20260826002800). Abonelik `tenant_id=eq.<ofis>` ile süzülür ve Realtime, satır RLS'ini
 * (portals/view + `lc_row_visible` rol kapsamı) kullanıcı JWT'siyle uygular: danışman yalnız kendi ilanlarının
 * olayını duyar, başka ofisin olayı hiç gelmez. Olay gelince sayfa `router.refresh()` ile yeniden okunur
 * (mevcut hook: arka planda sekmede bekler, iki yenileme arası >= 10 sn, olaylar birleştirilir). Bağlantı koparsa
 * sayfa eskisi gibi yenilemeyle güncellenir; hata yüzeye çıkmaz.
 */
export function ControlLiveRefresh({ tenantId }: { tenantId: string | null }) {
  useRealtimeRefresh({ tenantId, tables: ["listing_control_events"], debounceMs: 1500 });
  return null;
}
