/**
 * Aktarım fotoğrafı hazırlığı (SAF yardımcılar; eklentinin içerik betiği kullanır, testli). Fotoğraflar EmlakSoft'tan aynı kökenli
 * yetkili uçtan indirilir, portal yüklemesi için ≤ 1600 px JPEG'e küçültülür ve oturum deposuna (10 MB sınırı) sığması için
 * toplam bütçeyle sınırlanır. Bütçeyi aşan fotoğraflar ATLANIR ve kullanıcıya söylenir (sessiz kayıp yok).
 */

export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_JPEG_QUALITY = 0.85;
/** Tek fotoğraf için kabul edilen en büyük base64 uzunluğu (arka plan doğrulamasıyla aynı sınır). */
export const PHOTO_MAX_B64 = 1_500_000;
/** Tüm fotoğraflar için toplam base64 bütçesi (oturum deposu 10 MB; paket + pay bırakılır). */
export const PHOTO_TOTAL_B64_BUDGET = 7_000_000;

/** En uzun kenarı `maxSide`'a indirir (büyütmez). */
export function scaledSize(width: number, height: number, maxSide = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Bayt dizisi → base64 (büyük dizilerde yığın taşmasın diye parçalı). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export type BudgetDecision = { take: boolean; reason?: "too_large" | "over_budget" };

/** Bir sonraki fotoğraf bütçeye sığıyor mu? (`used` = şimdiye kadar alınan toplam base64 uzunluğu.) */
export function photoBudget(used: number, nextB64Length: number): BudgetDecision {
  if (nextB64Length <= 0 || nextB64Length > PHOTO_MAX_B64) return { take: false, reason: "too_large" };
  if (used + nextB64Length > PHOTO_TOTAL_B64_BUDGET) return { take: false, reason: "over_budget" };
  return { take: true };
}

/** Kullanıcıya fotoğraf özeti (Türkçe). */
export function photoSummary(stored: number, total: number): string {
  if (total === 0) return "Portföyde aktarılacak fotoğraf yok.";
  if (stored === total) return `${stored} fotoğraf hazır.`;
  return `${stored}/${total} fotoğraf hazır; kalanlar boyut sınırı nedeniyle alınamadı (portföyün medya sekmesinden elle ekleyin).`;
}
