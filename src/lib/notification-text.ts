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
