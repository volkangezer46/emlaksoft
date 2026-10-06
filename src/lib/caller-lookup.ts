/**
 * Arayan müşteriyi tanıma — telefon arama anahtarı (SAF; yalnız sunucu: `phone-rules` tam kütüphaneyi yükler).
 *
 * Saklama biçimi (CLAUDE.md "İletişim alanları"): TR `05XXXXXXXXX` / sabit `0XXXXXXXXXX`, yabancı `+<E.164>`.
 * Arama kutusuna ya da `/app/ara?tel=` kısayoluna gelen numara her biçimde olabilir ("0532 123 45 67", "+90 532…",
 * "(532) 123-4567", "+49 151…"). Tam numara `parsePhoneStrict` ile saklama biçimine çevrilir; kısmi numarada (en az 7 rakam)
 * son rakamlar kullanılır. Döndürülen `needle`, `phone` sütununda `ilike %needle%` ile eşleşir (biçim farkı eşleşmeyi bozmaz).
 * Malik (`properties.owner_customer_id`) ve kiracı (`rentals.renter_customer_id`) da `customers` kaydıdır: tek arama yeter.
 */
import { parsePhoneStrict } from "@/lib/phone-rules";

const PHONE_CHARS = /^[+\d\s().\-/]+$/;
export const MIN_PHONE_DIGITS = 7;

/** Metin telefon numarası mı? (yalnız rakam + ayraç, en az 7 rakam; harf varsa ad/e-posta aramasıdır) */
export function looksLikePhone(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s || !PHONE_CHARS.test(s)) return false;
  return s.replace(/\D/g, "").length >= MIN_PHONE_DIGITS;
}

export type PhoneNeedle = { stored: string | null; needle: string };

/**
 * Telefon arama anahtarı. `stored`: tam ve geçerli numaranın saklama biçimi (yeni müşteri ön dolgusu için), yoksa null.
 * `needle`: `phone ilike %needle%` için yalnız rakamlar (TR'de baştaki 0 ve ülke kodu 90 düşer → yerel 10 hane).
 */
export function phoneSearchNeedle(raw: string | null | undefined): PhoneNeedle | null {
  if (!looksLikePhone(raw)) return null;
  const s = String(raw).trim();
  const p = parsePhoneStrict(s);
  if (p.ok && p.stored) {
    const digits = p.stored.replace(/\D/g, "");
    // TR saklama "05…" → yerel 10 hane; yabancı "+49…" → ülke kodlu rakamlar (saklanan değerde aynen geçer).
    const needle = p.stored.startsWith("0") ? digits.slice(1) : digits;
    return { stored: p.stored, needle };
  }
  let digits = s.replace(/\D/g, "");
  if (s.startsWith("+90") || (digits.startsWith("90") && digits.length === 12)) digits = digits.slice(2);
  else if (digits.startsWith("0090")) digits = digits.slice(4);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return { stored: null, needle: digits.slice(-10) };
}

export type CallerMatch = { id: string };

/** Kısayol hedefi: tek eşleşme → kart; hiç yok → numarası dolu yeni müşteri formu; birden çok → arama sonuçları. */
export function callerRedirectPath(matches: readonly CallerMatch[], n: PhoneNeedle): string {
  if (matches.length === 1) return `/app/musteriler/${matches[0]!.id}`;
  if (matches.length === 0) return n.stored ? `/app/musteriler/yeni?phone=${encodeURIComponent(n.stored)}` : `/app/arama-sonuclari?q=${encodeURIComponent(n.needle)}`;
  return `/app/arama-sonuclari?q=${encodeURIComponent(n.needle)}`;
}
