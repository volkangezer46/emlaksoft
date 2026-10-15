"use client";

import { useEffect } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { invalidateClientCache } from "@/lib/client-cache-state";
import { detailForPath, parseTenantChange, routesForTable, tablesForPath } from "@/lib/realtime-throttle";
import {
  emitNotificationInsert,
  inboxTopic,
  loadRealtimeClient,
  NOTIFICATION_ROW_FIELDS,
  setActiveTenantId,
  subscribeTopic,
  tenantTopic,
  toNotificationRow,
  type NotificationInsertRow,
} from "@/lib/realtime";

/** Bildirim bağlantısının gösterdiği rotanın önbelleği geçersizlenir (B010: zil çaldı, liste eski kalmasın). */
function invalidateHref(href: string | null): void {
  if (!href || !href.startsWith("/app")) return;
  const path = href.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  invalidateClientCache([path]);
}

function deliver(row: NotificationInsertRow): void {
  invalidateHref(row.href);
  emitNotificationInsert(row);
}

/**
 * App layout: açık rotanın tablolarında değişiklik → soft refresh; bildirimler anında zile.
 *
 * Tek ofis konusu (`tenant:<ofis>`, deyim düzeyinde Broadcast; tablo/rota eşlemesi tek kaynak
 * src/lib/realtime-throttle.ts). Olay ~150 ms'de tazeler; iki tazeleme arası en az 2 sn (ana panoda 5 sn).
 * Kapalı rotaların önbelleği olayın tablosuna göre geçersizlenir (dönüşte arkadan tazelenir).
 * Bildirimler (sözleşme j): kişisel bildirim `inbox:<uid>` konusundan alıcının kendi alanlarıyla gelir; ortak bildirim
 * ofis konusundan YALNIZ kimlikle gelir, satır RLS'li okunur; ikisi de AYNI `NotificationInsertRow` olayını yayar.
 */
export function RealtimeRefresh({ tenantId }: { tenantId: string | null }) {
  useRealtimeRefresh({
    tenantId,
    tablesForPath,
    detailForPath,
    debounceMs: 150,
  });

  // Etkin ofis: ofis kimliği prop'u gelmeyen canlı bileşenler (destek konuşması) aynı ofis konusunu kullanır.
  useEffect(() => {
    setActiveTenantId(tenantId);
    return () => setActiveTenantId(null);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    let offInbox: (() => void) | null = null;
    const seen = new Set<string>();
    const once = (id: string) => {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > 200) seen.delete(seen.values().next().value as string);
      return true;
    };

    // Ortak bildirim: konu yalnız kimliği taşır; satır kullanıcının RLS'iyle okunur.
    const readShared = async (id: string) => {
      const client = await loadRealtimeClient();
      if (!client || cancelled) return;
      const { data } = await client.from("notifications").select(NOTIFICATION_ROW_FIELDS.join(", ")).eq("id", id).maybeSingle();
      const row = toNotificationRow(data);
      if (row && !cancelled && once(row.id)) deliver(row);
    };

    const offTenant = subscribeTopic(tenantTopic(tenantId), {
      on: {
        change: (payload) => {
          const evt = parseTenantChange(payload);
          if (evt) invalidateClientCache(routesForTable(evt.t));
        },
        notification: (payload) => {
          const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
          if (typeof id === "string") void readShared(id);
        },
      },
    });

    // Kişisel bildirim: oturumdaki kullanıcının kutusu (konu politikası auth.uid() ile eşler).
    void loadRealtimeClient().then(async (client) => {
      if (!client || cancelled) return;
      const { data } = await client.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!uid || cancelled) return;
      offInbox = subscribeTopic(inboxTopic(uid), {
        on: {
          notification: (payload) => {
            const row = toNotificationRow(payload);
            // Hedefli bildirim yalnızca hedefi bizsek (konu zaten kişisel; ikinci savunma).
            if (!row || (row.user_id && row.user_id !== uid) || !once(row.id)) return;
            deliver(row);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      offTenant();
      offInbox?.();
    };
  }, [tenantId]);

  return null;
}
