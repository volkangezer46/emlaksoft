// Arayüz tercihi: TEK GÖRÜNÜM (sahip kararı 2026-10-16). Eski "Sade görünüm" çerezi ve anahtarı kaldırıldı; sunucu
// sayfaları `getUiPrefs()` ile aynı ayarlı yerleşimi okur (sabit). Yazı boyutu BURADA DEĞİL: bkz. lib/font-scale.ts.

export type UiPrefs = { simple: boolean };

/** Tek görünümün sabit tercihi (ayarlı yerleşim: önemli bilgi görünür, ikincil ayrıntı katlı). */
export const DEFAULT_UI_PREFS: UiPrefs = { simple: true };

/**
 * Küçük ofis kuralı (sadeleştirme planı 2.1): ekibi en çok 5 kişi olan ve şubesi olmayan ofis "küçük ofis"tir
 * (Takımlar/Şubeler/Lig/TV temel sekme değildir). Ofis büyüklüğü bilinmiyorsa küçük sayılır.
 */
export const SMALL_OFFICE_MAX_SEATS = 5;
export type OfficeSize = { seats: number; branches: number };
export function isSmallOffice(size: OfficeSize | null | undefined): boolean {
  return !size || (size.seats <= SMALL_OFFICE_MAX_SEATS && size.branches === 0);
}
