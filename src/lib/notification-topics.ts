/**
 * Bildirim KONUSU (GA-08) — SAF (I/O yok; sunucu, istemci, service worker yükü ve testler aynı kuralı kullanır).
 *
 * Önem derecesi (`kind`: success/info/warning/danger/system) danışmana "ne hakkında" sorusunu yanıtlamaz; bildirim
 * merkezi konuya göre süzülür: Randevu · Görev · Atama · Müşteri · Portföy · Finans · Sistem.
 *
 * Kaynak sırası: (1) `notifyTenant` çağrısının `prefKey`'i → konu, (2) yoksa bağlantı (`href`) yolu → konu,
 * (3) hiçbiri → "sistem". DB tarafındaki `notifications_set_topic` tetikleyicisi (2) kuralının SQL kopyasıdır
 * (migration 20261018050000); iki liste `notification-topics.test.ts` ile birebir tutulur.
 */

export const NOTIFICATION_TOPICS = ["randevu", "gorev", "atama", "musteri", "portfoy", "finans", "sistem"] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export const TOPIC_LABEL: Record<NotificationTopic, string> = {
  randevu: "Randevular",
  gorev: "Görevler",
  atama: "Atamalar",
  musteri: "Müşteriler",
  portfoy: "Portföyler",
  finans: "Finans",
  sistem: "Sistem",
};

export function isNotificationTopic(value: unknown): value is NotificationTopic {
  return typeof value === "string" && (NOTIFICATION_TOPICS as readonly string[]).includes(value);
}

/** Bildirim tercihi anahtarı → konu (tercih anahtarı daha kesin bilgi taşır; bağlantıdan önce gelir). */
const PREF_TOPIC: Record<string, NotificationTopic> = {
  appointment: "randevu",
  task: "gorev",
  assignment: "atama",
  portal: "portfoy",
  priceDrop: "portfoy",
  authority: "portfoy",
  savedSearch: "musteri",
  share: "musteri",
  survey: "musteri",
  commission: "finans",
  dunning: "finans",
  rentOverdue: "finans",
  digest: "sistem",
  marketing: "sistem",
  support: "sistem",
  network: "sistem",
  insight: "sistem",
};

/**
 * Yol öneki → konu. SIRA ÖNEMLİ (ilk eşleşen kazanır). SQL tetikleyicisi bu listeyi aynı sırayla uygular.
 * Önek tam bir yol parçasıdır: `/app/gorevler` hem `/app/gorevler` hem `/app/gorevler?gorev=…` hem `/app/gorevler/eids/…`
 * ile eşleşir, `/app/gorevlerx` ile eşleşmez.
 */
export const TOPIC_HREF_PREFIXES: readonly (readonly [string, NotificationTopic])[] = [
  ["/app/randevular", "randevu"],
  ["/app/gorevler", "gorev"],
  ["/app/musteriler", "musteri"],
  ["/app/talepler", "musteri"],
  ["/app/gelen-kutusu", "musteri"],
  ["/app/anketler", "musteri"],
  ["/app/portfoyler", "portfoy"],
  ["/app/ilan-kontrol", "portfoy"],
  ["/app/ilan-havuzu", "portfoy"],
  ["/app/portfoy-avi", "portfoy"],
  ["/app/komisyon", "finans"],
  ["/app/anlasmalar", "finans"],
  ["/app/kiralama", "finans"],
  ["/app/kira-artis", "finans"],
  ["/app/aidat", "finans"],
  ["/app/giderler", "finans"],
  ["/app/cuzdan", "finans"],
  ["/app/abonelik", "finans"],
  ["/app/teklifler", "finans"],
];

export function topicFromHref(href: string | null | undefined): NotificationTopic | null {
  if (!href || !href.startsWith("/")) return null;
  const path = href.split(/[?#]/, 1)[0];
  for (const [prefix, topic] of TOPIC_HREF_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return topic;
  }
  return null;
}

export function notificationTopic(input: { prefKey?: string | null; href?: string | null }): NotificationTopic {
  if (input.prefKey && PREF_TOPIC[input.prefKey]) return PREF_TOPIC[input.prefKey];
  return topicFromHref(input.href) ?? "sistem";
}

// ---------------------------------------------------------------------------
// Push eylem düğmeleri (MP3 / GA-15) — yük KİŞİSEL VERİ taşımaz (telefon dışında; o da yalnız tel: bağlantısı).
// ---------------------------------------------------------------------------

/** Service worker'ın tanıdığı eylemler. `done`/`snooze` sunucuya POST eder; `open`/`call` yalnız gezinir. */
export type PushActionId = "open" | "call" | "done" | "snooze";
export type PushAction = { action: PushActionId; title: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Push yükündeki kayıt başvurusu: tür + kimlik (yalnız UUID). Service worker bunu `/api/push-eylem`'e iletir. */
export type PushEntityRef = { type: "task" | "appointment" | "customer"; id: string };

export function pushEntityRef(type: PushEntityRef["type"], id: string | null | undefined): PushEntityRef | undefined {
  return id && UUID_RE.test(id) ? { type, id: id.toLowerCase() } : undefined;
}

/**
 * Bildirim türüne göre en çok 2 eylem (Android/Chrome en çok 2 düğme gösterir; iOS göstermez, yalnız etiket uygular).
 *  - görev: Tamamla · Yarına ertele
 *  - telefonlu kayıt (cevapsız arama / yeni başvuru): Ara · Aç
 *  - diğerleri: Aç
 */
export function pushActionsFor(input: { entity?: PushEntityRef; tel?: string | null }): PushAction[] {
  if (input.entity?.type === "task") {
    return [
      { action: "done", title: "Tamamla" },
      { action: "snooze", title: "Yarına ertele" },
    ];
  }
  if (input.tel && safeTelHref(input.tel)) {
    return [
      { action: "call", title: "Ara" },
      { action: "open", title: "Aç" },
    ];
  }
  return [{ action: "open", title: "Aç" }];
}

/** Yalnız rakam ve baştaki + kabul edilir (7–16 hane); aksi null. sw.js aynı kuralı tekrar uygular. */
export function safeTelHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s()-]/g, "");
  return /^\+?\d{7,16}$/.test(compact) ? `tel:${compact}` : null;
}

/**
 * Bildirim etiketi (tag): aynı kayda ait ikinci bildirim yenisini EKLEMEZ, öncekinin yerine geçer.
 * Öncelik: tekrar önleme anahtarı → konu + kayıt → konu + bağlantı.
 */
export function pushTag(input: { topic: NotificationTopic; dedupeKey?: string | null; entity?: PushEntityRef; href?: string | null }): string {
  if (input.dedupeKey) return `d:${input.dedupeKey}`.slice(0, 120);
  if (input.entity) return `${input.topic}:${input.entity.id}`;
  return `${input.topic}:${(input.href ?? "/app").split("#", 1)[0]}`.slice(0, 120);
}
