/**
 * İlan fotoğrafı kalite ölçütü — saf fonksiyonlar (istemci + sunucu ortak, bağımlılıksız).
 *
 * Ölçüm yüklenen SON dosyanın pikselleridir (küçültme + filigran sonrası, EXIF yönü uygulanmış). Portallar ve vitrin
 * görseli en az ~1024 px genişlikte gösterir; altı bulanık görünür. Eşikler bilinçli olarak sade ve açıktır:
 *  - düşük çözünürlük: uzun kenar < 1024 px ya da kısa kenar < 600 px
 *  - dikey: en/boy < 0,9 (ilan kapağı ve portallar yatay kare kullanır; dikey kapak kırpılır)
 *  - aşırı geniş: en/boy > 2,4 (panorama; kapakta ortası kırpılır)
 * Boyutu bilinmeyen (eski, ölçülmemiş) görsel için uyarı üretilmez — veri yoksa uyarı yok.
 */

export const PHOTO_MIN_LONG_EDGE = 1024;
export const PHOTO_MIN_SHORT_EDGE = 600;
const PORTRAIT_RATIO = 0.9;
const PANORAMA_RATIO = 2.4;

export type PhotoDims = { width?: number | null; height?: number | null };

export type PhotoIssue = "low_resolution" | "portrait" | "panorama";

export type PhotoQuality = {
  known: boolean;
  issues: PhotoIssue[];
  /** Kısa uyarı metni (ilk sorun) ya da null. */
  warning: string | null;
  /** Kapak uygunluk puanı (yalnız sıralama için; ekranda gösterilmez). */
  coverScore: number;
};

function valid(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

export function formatDims(d: PhotoDims): string | null {
  return valid(d.width) && valid(d.height) ? `${Math.round(d.width)}×${Math.round(d.height)}` : null;
}

export function assessPhoto(d: PhotoDims): PhotoQuality {
  if (!valid(d.width) || !valid(d.height)) return { known: false, issues: [], warning: null, coverScore: 0 };
  const w = d.width;
  const h = d.height;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const ratio = w / h;
  const issues: PhotoIssue[] = [];
  if (long < PHOTO_MIN_LONG_EDGE || short < PHOTO_MIN_SHORT_EDGE) issues.push("low_resolution");
  if (ratio < PORTRAIT_RATIO) issues.push("portrait");
  if (ratio > PANORAMA_RATIO) issues.push("panorama");
  const dims = `${Math.round(w)}×${Math.round(h)}`;
  const warning = issues.includes("low_resolution")
    ? `Düşük çözünürlük (${dims}): ilanda bulanık görünür. En az ${PHOTO_MIN_LONG_EDGE} px genişlikte çekin.`
    : issues.includes("portrait")
      ? `Dikey fotoğraf (${dims}): kapakta kırpılır; yatay çekim önerilir.`
      : issues.includes("panorama")
        ? `Çok geniş fotoğraf (${dims}): kapakta kenarları kırpılır.`
        : null;
  // Kapak puanı: piksel (üst sınırlı) + yatay 4:3–16:9 bonusu − sorun cezası.
  const pixels = Math.min(w * h, 4_000_000) / 4_000_000;
  const landscape = ratio >= 1.2 && ratio <= 1.9 ? 0.5 : ratio >= 1 ? 0.2 : 0;
  const coverScore = pixels + landscape - issues.length * 0.6;
  return { known: true, issues, warning, coverScore };
}

export type CoverCandidate = PhotoDims & { id: string; is_cover?: boolean | null };

/**
 * Kapak önerisi: mevcut kapak ölçülmüş ve sorunluysa (düşük çözünürlük/dikey/panorama) ya da hiç kapak yoksa,
 * ölçülmüş ve SORUNSUZ görseller arasından en yüksek puanlıyı önerir. Mevcut kapak sorunsuzsa ya da daha iyi aday
 * yoksa null (boş vaat yok).
 */
export function suggestCover(items: readonly CoverCandidate[]): { id: string; reason: string } | null {
  const cover = items.find((m) => m.is_cover);
  const coverQ = cover ? assessPhoto(cover) : null;
  if (cover && (!coverQ?.known || coverQ.issues.length === 0)) return null;
  let best: { id: string; q: PhotoQuality } | null = null;
  for (const m of items) {
    if (m.is_cover) continue;
    const q = assessPhoto(m);
    if (!q.known || q.issues.length > 0) continue;
    if (!best || q.coverScore > best.q.coverScore) best = { id: m.id, q };
  }
  if (!best) return null;
  const dims = formatDims(items.find((m) => m.id === best.id) ?? { width: null, height: null }) ?? "";
  const reason = !cover
    ? `Kapak seçilmemiş; en net yatay fotoğraf (${dims}) önerilir.`
    : coverQ?.issues.includes("low_resolution")
      ? `Kapak düşük çözünürlüklü; daha net bir yatay fotoğraf (${dims}) var.`
      : `Kapak ${coverQ?.issues.includes("portrait") ? "dikey" : "çok geniş"}; yatay bir fotoğraf (${dims}) kapakta daha iyi görünür.`;
  return { id: best.id, reason };
}
