"use client";

import { useEffect } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { createClient } from "@/lib/supabase/client";
import { emitNotificationInsert, type NotificationInsertRow } from "@/lib/realtime";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** App layout: kritik tablolarda değişiklik → soft refresh */
export function RealtimeRefresh({ tenantId }: { tenantId: string | null }) {
  useRealtimeRefresh({
    tenantId,
    tables: ["notifications", "deals", "commissions", "portal_listings", "customers"],
    debounceMs: 600,
  });

  // Bildirim INSERT'lerini anlık olarak zile köprüle. Kanal burada açılıyor
  // çünkü tenantId layout'tan yalnızca bu bileşene geliyor; zil sadece
  // window event dinler (bkz. src/lib/realtime.ts). Soft refresh yukarıdaki
  // hook'ta zaten var — bağlantı koparsa davranış ona (ve panel açılınca
  // fetch'e) düşer, hata yüzeye çıkmaz.
  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Kullanıcıya özel bildirimleri (user_id dolu) başka kullanıcıya
    // sızdırmamak için önce oturumdaki user id okunur; abonelik sonra kurulur.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const uid = data.session?.user?.id ?? null;
      channel = supabase
        .channel(`es-rt-notif:${tenantId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter: `tenant_id=eq.${tenantId}` },
          (payload) => {
            const row = payload.new as NotificationInsertRow;
            // Hedefli bildirim yalnızca hedefi bizsek; genel (user_id null) herkese.
            if (row.user_id && row.user_id !== uid) return;
            emitNotificationInsert(row);
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return null;
}
