/**
 * Türkiye telefon numarası standardı: ulusal format, 11 hane, 0 ile başlar (05XXXXXXXXX).
 * Tüm DB kayıtları ve iç mantık bu formatı kullanır; dış servislere (WhatsApp, iyzico)
 * gönderilirken +90/90 önekli E.164 biçimine anlık çevrilir.
 */

const MOBILE_RE = /^05\d{9}$/;

/** Her türlü girdiyi (boşluklu, +90'lı, 90'lı, 10 haneli) 05XXXXXXXXX'e normalize eder. */
export function normalizeTurkishPhone(input: string | null | undefined): string {
  let digits = (input ?? "").replace(/\D/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(2);
  if (digits.startsWith("90") && digits.length >= 12) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("5")) digits = `0${digits}`;
  return digits.slice(0, 11);
}

/** Yazarken canlı temizleme: sadece rakam, en fazla 11 hane, ilk hane 0 olmalı. */
export function sanitizeTurkishPhoneInput(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  return digits.startsWith("0") ? digits : `0${digits}`.slice(0, 11);
}

/** 05XXXXXXXXX kalıbına tam uyup uymadığını kontrol eder (normalize ettikten sonra). */
export function isValidTurkishMobile(input: string | null | undefined): boolean {
  if (!input) return false;
  return MOBILE_RE.test(normalizeTurkishPhone(input));
}

/** Boşsa geçerli sayar (opsiyonel alanlar için), doluysa mobil formatı zorunlu kılar. */
export function isValidOptionalTurkishMobile(input: string | null | undefined): boolean {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return true;
  return isValidTurkishMobile(trimmed);
}

/** Görüntüleme: 05XXXXXXXXX -> "0XXX XXX XX XX" (4-3-2-2 boşluklu). */
export function formatTurkishPhone(input: string | null | undefined): string {
  const digits = normalizeTurkishPhone(input);
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

/** E.164: 05XXXXXXXXX -> +905XXXXXXXX (WhatsApp/iyzico/SMS entegrasyonları için). */
export function toE164TurkishPhone(input: string | null | undefined): string {
  const digits = normalizeTurkishPhone(input);
  if (!digits) return "";
  return `+90${digits.slice(1)}`;
}

/** wa.me linki için ülke kodlu, +'sız, boşluksuz format: 905XXXXXXXXX. */
export function toWhatsAppMsisdn(input: string | null | undefined): string {
  const digits = normalizeTurkishPhone(input);
  if (!digits) return "";
  return `90${digits.slice(1)}`;
}

export function toWhatsAppLink(input: string | null | undefined, message?: string): string | null {
  const msisdn = toWhatsAppMsisdn(input);
  if (!msisdn) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${msisdn}${query}`;
}

export function toTelHref(input: string | null | undefined): string | null {
  const digits = normalizeTurkishPhone(input);
  if (!digits) return null;
  return `tel:${digits}`;
}

export const TR_MOBILE_PLACEHOLDER = "05XX XXX XX XX";
export const TR_MOBILE_ERROR_MESSAGE = "Geçerli bir cep telefonu girin (05XX XXX XX XX)";
