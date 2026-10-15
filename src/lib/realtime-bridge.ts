/**
 * Realtime köprüsü: bağımlılıksız küçük parçalar (zil ve kabuk ilk yükünde bulunur; realtime çekirdeği tembel gelir).
 *  - `ensureRealtimeAuth`: kanal katılımından önce oturum jetonu.
 *  - Bildirim köprüsü: kanalı dinleyen tek yer (RealtimeRefresh) window olayı yayar; zil `onNotificationInsert` dinler.
 * `src/lib/realtime.ts` bunları aynen yeniden dışa aktarır (tek kaynak burası).
 */

/**
 * Kanal katılımı (phx_join) oturum jetonunu taşısın diye abone olmadan ÖNCE çağrılır. supabase-js jetonu oturum
 * okunduktan sonra (INITIAL_SESSION) eşzamansız verir; ondan önce abone olan kanal anon katılır, özel kanal reddedilir
 * (saha ölçümü 2026-10-15: doğrudan açılan /app sayfalarında 150 sn'de 0 olay).
 * Argümansız setAuth istemcinin jeton geri çağrısını (oturum) kullanır; yenilenen jeton da aynı yoldan gider.
 */
export async function ensureRealtimeAuth(client: { realtime: { setAuth: (token?: string | null) => Promise<void> } }): Promise<void> {
  try {
    await client.realtime.setAuth();
  } catch {
    // Jeton alınamadı: kanal yine açılır; reddedilirse hub geri çekilmeyle yeniden dener.
  }
}

/** Zile giden bildirim satırı: kişisel bildirimde `inbox:<uid>` yükü, ortak bildirimde RLS'li okuma (sözleşme j). */
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

export const NOTIF_INSERT_EVENT = "es:notification-insert";

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
