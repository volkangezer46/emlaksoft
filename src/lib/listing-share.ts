/**
 * Portföy paylaşımı (MP7) — SAF yardımcılar (sunucu action'ı + istemci + test).
 */

/** Web Share ile gönderilecek en çok fotoğraf (WhatsApp/Instagram pratiği). */
export const SHARE_MAX_PHOTOS = 10;
/** Bir paylaşımda en çok portföy (sunumlar). */
export const SHARE_MAX_PROPERTIES = 20;
/** Toplam dosya boyutu tavanı (byte) — mobil paylaşım sayfası büyük yükte düşer. */
export const SHARE_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
/** Bu boyutun üstündeki görsel küçültülür. */
export const SHARE_DOWNSCALE_BYTES = 2.5 * 1024 * 1024;
export const SHARE_MAX_EDGE = 2048;

/**
 * Sıralı medya satırlarından paylaşılacak fotoğraf id'leri: portföyler `order` sırasıyla dolaşılır, her turda
 * her portföyden bir görsel alınır (sunumda her ilanın kapağı önce gelir); tek portföyde ilk N görsel.
 */
export function pickSharePhotoIds(
  rows: readonly { id: string; property_id: string }[],
  order: readonly string[],
  max = SHARE_MAX_PHOTOS,
): string[] {
  const byProp = new Map<string, string[]>();
  for (const r of rows) {
    const list = byProp.get(r.property_id) ?? [];
    list.push(r.id);
    byProp.set(r.property_id, list);
  }
  const queues = order.map((id) => byProp.get(id) ?? []).filter((q) => q.length > 0);
  const out: string[] = [];
  let round = 0;
  while (out.length < max && queues.some((q) => q.length > round)) {
    for (const q of queues) {
      if (out.length >= max) break;
      if (q.length > round) out.push(q[round]);
    }
    round += 1;
  }
  return out;
}

/** Paylaşım metni: başlık + açıklama + bağlantı (dosyalı paylaşımda birçok uygulama `url` alanını atar → metne gömülür). */
export function buildShareText(parts: { text?: string | null; url?: string | null }): string {
  return [parts.text?.trim(), parts.url?.trim()].filter(Boolean).join("\n\n");
}

/** MIME → dosya uzantısı. */
export function shareFileExt(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/webp/i.test(mime)) return "webp";
  if (/gif/i.test(mime)) return "gif";
  if (/avif/i.test(mime)) return "avif";
  return "jpg";
}
