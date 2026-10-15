/**
 * Bildirim gövdesi gösterimi — SAF (I/O yok; istemci ve sunucu aynı kuralı kullanır).
 *
 * Cron'lar tekrar bildirimi önlemek için gövdenin SONUNA makine izi yazar: `… · task:<uuid>`, `… · appt:<uuid>`
 * (`findNotifiedIds` bu izi okur; DB ve cron'lar DEĞİŞMEZ). Kullanıcı bu izi görmemeli: zil panelleri ve
 * `/app/bildirimler` gövdeyi `stripNotificationMarker` ile gösterir, bağlantıyı `notificationHref` ile kurar.
 */

const MARKER_RE = / · ([a-z0-9_]+):([0-9a-f-]{36})$/;

/** Gövdenin sonundaki makine izini (` · task:<uuid>`) siler; iz yoksa gövde aynen döner. */
export function stripNotificationMarker(body: string): string;
export function stripNotificationMarker(body: string | null | undefined): string | null;
export function stripNotificationMarker(body: string | null | undefined): string | null {
  if (body == null) return null;
  return body.replace(MARKER_RE, "");
}

/** Gövdedeki iz: tür (`task`, `appt`…) ve kayıt kimliği; yoksa null. */
export function notificationMarker(body: string | null | undefined): { kind: string; id: string } | null {
  const m = MARKER_RE.exec(body ?? "");
  return m ? { kind: m[1], id: m[2].toLowerCase() } : null;
}

/** Tek görevi açan bağlantı: `/app/gorevler?gorev=<id>` yalnız o görevi listeler, düzenleme paneli açık gelir. */
export function taskHref(id: string): string {
  return `/app/gorevler?gorev=${encodeURIComponent(id)}`;
}

/** Tek randevuyu açan bağlantı: `/app/randevular?randevu=<id>` yalnız o randevuyu listeler, düzenleme paneli açık gelir. */
export function appointmentHref(id: string): string {
  return `/app/randevular?randevu=${encodeURIComponent(id)}`;
}

/**
 * Bildirimin götüreceği yol. Gövdedeki izden kaydın kendisine giden hedef türetilebiliyorsa onu, yoksa mevcut
 * `href`'i döndürür. Yalnız genel liste bağlantısı (`/app/gorevler`, `/app/randevular`) iyileştirilir; özel bir
 * `href` taşıyan bildirim olduğu gibi kalır (cron'lar tekrar önleme için genel `href` yazar, DB değişmez):
 *  - task → `/app/gorevler?gorev=<id>` (gövde: `<başlık> · <vade> · task:<id>`),
 *  - appt → `/app/randevular?randevu=<id>` (gövde: `<müşteri> · <zaman>[ · Teyit: …] · appt:<id>`),
 *  - diğer türler → mevcut `href`.
 */
export function notificationHref(n: { href: string | null; body: string | null }): string | null {
  const marker = notificationMarker(n.body);
  if (!marker || !n.body) return n.href;
  if (marker.kind === "task" && n.href === "/app/gorevler") return taskHref(marker.id);
  if (marker.kind === "appt" && n.href === "/app/randevular") return appointmentHref(marker.id);
  return n.href;
}

// ---------------------------------------------------------------------------
// Okunmamış sayacı (tek kaynak: DB `my_notification_counts()`; zil ve /app/bildirimler aynı değeri gösterir)
// ---------------------------------------------------------------------------

/** `topics` yalnız konu migration'ı (20261018050000) uygulandıysa gelir; yoksa undefined (konu çipleri gizlenir). */
export type NotificationCounts = { unread: number; total: number; week: number; kinds: Record<string, number>; topics?: Record<string, number> };

export const EMPTY_NOTIFICATION_COUNTS: NotificationCounts = { unread: 0, total: 0, week: 0, kinds: {} };

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `my_notification_counts()` jsonb çıktısını güvenle okur; bozuk/eksik alan 0 sayılır. */
export function parseNotificationCounts(raw: unknown): NotificationCounts {
  if (!raw || typeof raw !== "object") return EMPTY_NOTIFICATION_COUNTS;
  const r = raw as Record<string, unknown>;
  const kinds: Record<string, number> = {};
  if (r.kinds && typeof r.kinds === "object") {
    for (const [k, v] of Object.entries(r.kinds as Record<string, unknown>)) kinds[k] = count(v);
  }
  let topics: Record<string, number> | undefined;
  if (r.topics && typeof r.topics === "object") {
    topics = {};
    for (const [k, v] of Object.entries(r.topics as Record<string, unknown>)) topics[k] = count(v);
  }
  return { unread: count(r.unread), total: count(r.total), week: count(r.week), kinds, ...(topics ? { topics } : {}) };
}

/** Rozet metni: 99'a kadar gerçek sayı, üstü "99+" (eskiden 9'da kesiliyordu; 30→31 görünmüyordu). */
export function notificationBadgeLabel(unread: number): string {
  return unread > 99 ? "99+" : String(Math.max(0, Math.floor(unread)));
}

/**
 * Zile ek olarak anında toast gösterilecek bildirim mi? Yalnız KULLANICIDAN KARAR/YANIT bekleyen olaylar:
 *  - onay kuyruğuna düşen talep (`/app/onaylar?durum=bekliyor`),
 *  - müşterinin online randevu talebi, iptal/erteleme talebi ve iptali (`/app/randevular…`).
 * Hatırlatma/özet gibi cron bildirimleri ve bilgi amaçlı "Randevu onaylandı" yalnız zilde kalır (toast gürültüsü yok).
 * Başlıklar emoji önekiyle gelebilir ("📅 Online randevu: …"), bu yüzden başa sabitlenmez.
 */
const ATTENTION_APPOINTMENT_RE = /(?:^|\s)(?:Online randevu|Randevu iptal talebi|Randevu erteleme talebi|Randevu iptal edildi)\b/u;

export function notificationNeedsAttention(n: { href: string | null; title: string }): boolean {
  const href = n.href ?? "";
  if (href.startsWith("/app/onaylar") && /[?&]durum=bekliyor(?:&|$)/.test(href)) return true;
  if (href.startsWith("/app/randevular") && ATTENTION_APPOINTMENT_RE.test(n.title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Zil durumu (saf indirgeyiciler; zil kabuğu ve paneli aynı durumu paylaşır)
// ---------------------------------------------------------------------------

type ReadableItem = { id: string; read_at: string | null };

/** Zil: liste (en yeni ≤50) + sunucunun gerçek okunmamış sayısı + rozet nabız anahtarı (artışta değişir). */
export type BellState<T extends ReadableItem = ReadableItem> = { items: T[]; unread: number; pulse: number };

/** `reads:<uid>` yayın yükü: okunan kimlikler (en çok 50) ve toplam okuma sayısı. */
export type NotificationReadsPayload = { ids: string[]; n: number };

export function parseReadsPayload(raw: unknown): NotificationReadsPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { ids?: unknown; n?: unknown };
  const ids = Array.isArray(r.ids) ? r.ids.filter((v): v is string => typeof v === "string") : [];
  const n = Number(r.n);
  if (ids.length === 0 && !(Number.isFinite(n) && n > 0)) return null;
  return { ids, n: Number.isFinite(n) && n > ids.length ? Math.floor(n) : ids.length };
}

/**
 * Başka cihaz/sekmedeki (ya da bu sekmedeki form) okuma: listede okunmamış olanlar okunur, liste DIŞINDAKİ
 * kimlikler de sayaçtan düşer (yayın yalnız yeni yazılan okumaları taşır; sunucuda okunmamıştı). Listede zaten
 * okunmuş görünen kimlik (bu sekmenin iyimser okuması) ikinci kez düşülmez.
 */
export function applyReadsToBell<T extends ReadableItem>(s: BellState<T>, ids: readonly string[], nowIso: string): BellState<T> {
  if (ids.length === 0) return s;
  const idSet = new Set(ids);
  const known = new Set(s.items.map((n) => n.id));
  let newly = 0;
  const items = s.items.map((n) => {
    if (!idSet.has(n.id) || n.read_at) return n;
    newly += 1;
    return { ...n, read_at: nowIso };
  });
  const outside = [...idSet].filter((id) => !known.has(id)).length;
  if (newly === 0 && outside === 0) return s;
  return { ...s, items: newly > 0 ? items : s.items, unread: Math.max(0, s.unread - newly - outside) };
}

/** Tek bildirimi iyimser okundu yap (listede okunmamışsa sayaç −1). */
export function markBellItemRead<T extends ReadableItem>(s: BellState<T>, id: string, nowIso: string): BellState<T> {
  const target = s.items.find((n) => n.id === id);
  if (!target || target.read_at) return s;
  return { ...s, items: s.items.map((n) => (n.id === id ? { ...n, read_at: nowIso } : n)), unread: Math.max(0, s.unread - 1) };
}

/** İyimser tek okumayı geri al (sunucu reddetti): yalnız bu işlemin yazdığı `read_at` geri döner, sayaç +1. */
export function unmarkBellItemRead<T extends ReadableItem>(s: BellState<T>, id: string, markedAt: string): BellState<T> {
  const target = s.items.find((n) => n.id === id);
  if (!target || target.read_at !== markedAt) return s;
  return { ...s, items: s.items.map((n) => (n.id === id ? { ...n, read_at: null } : n)), unread: s.unread + 1 };
}

/** "Tümünü oku" iyimser: listedeki tüm okunmamışlar okunur, sayaç 0. */
export function markBellAllRead<T extends ReadableItem>(s: BellState<T>, nowIso: string): BellState<T> {
  if (s.unread === 0 && s.items.every((n) => n.read_at)) return s;
  return { ...s, items: s.items.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })), unread: 0 };
}

/**
 * "Tümünü oku" geri al: bu işlemin okuduğu satırlar yeniden okunmamış, sayaç işlem öncesi değerine döner; arada canlı
 * gelen yeni bildirimler (işlemden sonra eklenen, okunmamış) korunur ve sayılır.
 */
export function revertBellAllRead<T extends ReadableItem>(s: BellState<T>, before: BellState<T>, markedAt: string): BellState<T> {
  const beforeIds = new Set(before.items.map((n) => n.id));
  const arrived = s.items.filter((n) => !beforeIds.has(n.id) && !n.read_at).length;
  return {
    ...s,
    items: s.items.map((n) => (n.read_at === markedAt && beforeIds.has(n.id) ? { ...n, read_at: null } : n)),
    unread: before.unread + arrived,
  };
}

/** Canlı yeni bildirim: başa eklenir (en çok `max`), okunmamışsa sayaç +1 ve rozet nabzı. Aynı kimlik ikinci kez eklenmez. */
export function addBellItem<T extends ReadableItem>(s: BellState<T>, item: T, max: number): BellState<T> {
  if (s.items.some((n) => n.id === item.id)) return s;
  const unreadAdd = item.read_at ? 0 : 1;
  return { items: [item, ...s.items].slice(0, max), unread: s.unread + unreadAdd, pulse: s.pulse + unreadAdd };
}
