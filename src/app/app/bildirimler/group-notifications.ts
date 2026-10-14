/**
 * Bildirim arşivi için saf yardımcılar (sunucu bileşeni ve test kullanır; tarayıcı/DB bağımlılığı yok).
 *
 * - `groupNotifications`: aynı sayfadaki aynı başlık + türdeki kayıtları tek satıra indirir (en yeni kayıt temsilcidir,
 *   sayfa sırası korunur, satırda "× N" gösterilir). Tekrarlı cron uyarıları (ör. "Portal teyit gecikti") listeyi boğmaz.
 * - `notificationTimeLabel`: göreli zaman yalnız geçmiş kayıtlarda; gelecek tarihli (saat kayması/test verisi) kayıt
 *   "az önce" görünmez, mutlak tarih gösterilir.
 */

export type GroupableNotification = {
  id: string;
  title: string;
  kind: string;
  read_at: string | null;
  created_at: string;
};

export type NotificationGroup<T extends GroupableNotification> = {
  /** Gruptaki en yeni kayıt (sayfa sırası created_at azalan olduğundan ilk görülen). */
  head: T;
  count: number;
  /** Gruptaki okunmamış kayıt kimlikleri: grup satırındaki "okundu" düğmesi hepsini işaretler. */
  unreadIds: string[];
};

export function groupNotifications<T extends GroupableNotification>(rows: readonly T[]): NotificationGroup<T>[] {
  const byKey = new Map<string, NotificationGroup<T>>();
  const out: NotificationGroup<T>[] = [];
  for (const row of rows) {
    const key = `${row.kind}\u0000${row.title}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (!row.read_at) existing.unreadIds.push(row.id);
      continue;
    }
    const group: NotificationGroup<T> = { head: row, count: 1, unreadIds: row.read_at ? [] : [row.id] };
    byKey.set(key, group);
    out.push(group);
  }
  return out;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function absoluteDate(t: number): string {
  return new Date(t).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
}

/** `nowMs` çağıran taraftan gelir (`@/lib/clock` now()); fonksiyon saf kalır. */
export function notificationTimeLabel(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = nowMs - t;
  if (diff < 0) return absoluteDate(t);
  if (diff < MIN) return "az önce";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} dk önce`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} sa önce`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} gün önce`;
  return absoluteDate(t);
}
