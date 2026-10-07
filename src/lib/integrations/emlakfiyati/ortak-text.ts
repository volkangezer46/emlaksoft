/**
 * Ortak değerleme serbest metin kuralı (BAĞIMLILIKSIZ; istemci paketine zod taşımasın diye `ortak-contract.ts`ten ayrıldı,
 * orada aynen yeniden dışa aktarılır — tek kaynak).
 */
const LONG_DIGITS_RE = /\d{11,}/;
const PHONE_LIKE_RE = /(?:^|\D)0?5\d{9}(?:\D|$)/;

/** Serbest metinde kişisel veri riski: `@`, 11+ rakam (TC/telefon) ve 05XXXXXXXXX benzeri örüntü. */
export function freeTextHasPersonalData(value: string): boolean {
  if (/@/.test(value)) return true;
  const compact = value.replace(/[\s.\-+()]/g, "");
  return LONG_DIGITS_RE.test(compact) || PHONE_LIKE_RE.test(compact);
}

export const ORTAK_FREE_TEXT_WARNING =
  "Bu alana ad, telefon, e-posta, TC kimlik numarası veya adres yazmayın; yalnızca site/apartman/blok adı girin.";
