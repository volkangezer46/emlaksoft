/**
 * Portföy listesi küçük resmi (B031) — SAF yardımcılar (istemci/sunucu güvenli, ağ yok).
 *
 * Liste kapak görseli eskiden tam boy indirme ucundan (`/download`, `no-store`) geliyordu: sayfa başına MB'larca PNG.
 * Şimdi `/api/property-media/<id>/thumb?v=<özet>`: 160 px WebP, `private, max-age=31536000, immutable`.
 * `v` içerik özetidir (depo yolu + boyut + filigran durumu): görsel değişirse URL de değişir, eski önbellek
 * kendiliğinden düşer. Uç, istekteki `v` güncel özetle eşleşmiyorsa uzun önbellek başlığı vermez.
 */

export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 120;
export const THUMB_QUALITY = 60;
/** Boyut türevleri: liste satırı (varsayılan) ve kart görünümü kapağı (h-36 kutu, 2x yoğunluk). */
export const THUMB_SIZES = { liste: { width: THUMB_WIDTH, height: THUMB_HEIGHT }, kart: { width: 480, height: 288 } } as const;
export type ThumbSize = keyof typeof THUMB_SIZES;

export function thumbSizeOf(raw: string | null | undefined): ThumbSize {
  return raw === "kart" ? "kart" : "liste";
}
export const THUMB_CACHE_CONTROL = "private, max-age=31536000, immutable";

type ThumbSource = { storage_path?: string | null; file_size?: number | string | null; has_watermark?: boolean | null };

/** FNV-1a 32 bit — kısa, deterministik içerik özeti (kriptografik değil; yalnız önbellek anahtarı). */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function thumbDigest(media: ThumbSource): string {
  return fnv1a([media.storage_path ?? "", String(media.file_size ?? ""), media.has_watermark ? "w" : ""].join("|"));
}

export function propertyThumbUrl(mediaId: string, media: ThumbSource, size: ThumbSize = "liste"): string {
  return `/api/property-media/${mediaId}/thumb?v=${thumbDigest(media)}${size === "liste" ? "" : `&s=${size}`}`;
}
