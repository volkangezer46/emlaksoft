"use client";

/**
 * Supabase Realtime yardımcıları (yalnızca tarayıcı).
 *
 * - `subscribeToInserts`: tek tabloya filtreli INSERT aboneliği; dönen fonksiyon
 *   kanalı kaldırır (StrictMode çift-mount güvenli — her çağrı kendi kanalını
 *   açar/kapatır). Bağlantı kurulamazsa sessiz kalır; çağıran mevcut
 *   davranışına (panel açılınca fetch / router.refresh) düşer.
 * - Bildirim INSERT'leri için hafif bir window event köprüsü: kanalı tenantId
 *   bilgisine sahip tek bir yer (RealtimeRefresh) açar, zil gibi tüketiciler
 *   yalnızca event dinler. Böylece aynı tabloya birden çok soket aboneliği
 *   açılmaz ve zil bileşeni tenant/user bilgisi taşımak zorunda kalmaz.
 */

import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";

export function subscribeToInserts<T extends Record<string, unknown>>(opts: {
  /** Kanal adı benzersiz olmalı (ör. `es-rt-ticket:${id}`). */
  channel: string;
  table: string;
  /** postgres_changes filtresi, ör. `ticket_id=eq.${id}` (RLS yine de geçerli). */
  filter?: string;
  onInsert: (row: T) => void;
}): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(opts.channel)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: opts.table,
        ...(opts.filter ? { filter: opts.filter } : {}),
      },
      (payload: RealtimePostgresInsertPayload<T>) => opts.onInsert(payload.new),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** notifications tablosundan Realtime ile gelen ham satır. */
export type NotificationInsertRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};

const NOTIF_INSERT_EVENT = "es:notification-insert";

export function emitNotificationInsert(row: NotificationInsertRow): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NotificationInsertRow>(NOTIF_INSERT_EVENT, { detail: row }));
}

export function onNotificationInsert(cb: (row: NotificationInsertRow) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<NotificationInsertRow>).detail);
  window.addEventListener(NOTIF_INSERT_EVENT, handler);
  return () => window.removeEventListener(NOTIF_INSERT_EVENT, handler);
}
