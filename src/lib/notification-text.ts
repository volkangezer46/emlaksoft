/**
 * Bildirim gövdesi gösterimi — SAF (I/O yok; istemci ve sunucu aynı kuralı kullanır).
 *
 * Cron'lar tekrar bildirimi önlemek için gövdenin SONUNA makine izi yazar: `… · task:<uuid>`, `… · appt:<uuid>`
 * (`findNotifiedIds` bu izi okur; DB ve cron'lar DEĞİŞMEZ). Kullanıcı bu izi görmemeli: zil panelleri ve
 * `/app/bildirimler` gövdeyi `stripNotificationMarker` ile gösterir, bağlantıyı `notificationHref` ile kurar.
 */

const MARKER_RE = / · ([a-z0-9_]+):([0-9a-f-]{36})$/;
const SEP = " · ";

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

/**
 * Görev listesinde tek göreve süzülmüş bağlantı. `/app/gorevler` tekil görev parametresi (`?gorev=`) sunmaz;
 * sunucu taraflı başlık araması (`?q=`, başlık + not, en çok 80 karakter) o kaydı listeler.
 */
export function taskListHref(title: string): string {
  const q = title.trim().slice(0, 80);
  return q ? `/app/gorevler?q=${encodeURIComponent(q)}` : "/app/gorevler";
}

/**
 * Bildirimin götüreceği yol. Gövdedeki izden kayda daha yakın bir hedef türetilebiliyorsa onu, yoksa mevcut
 * `href`'i döndürür. Yalnız genel liste bağlantısı (`/app/gorevler`, `/app/randevular`) iyileştirilir; özel bir
 * `href` taşıyan bildirim olduğu gibi kalır. Hedef sayfa tekil kayıt parametresi sunmadığından:
 *  - task → `/app/gorevler?q=<görev başlığı>` (gövde: `<başlık> · <vade> · task:<id>`),
 *  - appt → `/app/randevular?q=<müşteri adı>` (gövde: `<müşteri> · <zaman>[ · Teyit: …] · appt:<id>`;
 *    ad bilinmiyorsa ("Müşteri") mevcut bağlantı kalır),
 *  - diğer türler → mevcut `href`.
 */
export function notificationHref(n: { href: string | null; body: string | null }): string | null {
  const marker = notificationMarker(n.body);
  if (!marker || !n.body) return n.href;
  const text = stripNotificationMarker(n.body);
  if (marker.kind === "task" && n.href === "/app/gorevler") {
    const cut = text.lastIndexOf(SEP);
    const title = cut > 0 ? text.slice(0, cut) : text;
    return taskListHref(title);
  }
  if (marker.kind === "appt" && n.href === "/app/randevular") {
    const cut = text.indexOf(SEP);
    const name = (cut > 0 ? text.slice(0, cut) : "").trim();
    if (!name || name === "Müşteri") return n.href;
    return `/app/randevular?q=${encodeURIComponent(name.slice(0, 80))}`;
  }
  return n.href;
}
