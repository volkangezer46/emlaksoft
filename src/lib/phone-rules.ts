/**
 * Telefon ÜLKE KURALLARI: tek merkez (libphonenumber-js/min metadata'sı).
 *
 * - SUNUCU: `parsePhoneStrict` — `parsePhone` yapısal ayrıştırmasından geçen numarayı ülkenin gerçek
 *   numaralandırma planına göre (isValid) doğrular. Telefon kaydeden her server action bunu (veya
 *   `@/lib/validation/contact` şemalarını) kullanır. İSTEMCİ: yalnız PhoneInput, dinamik import ile.
 * - Bu dosya /app ilk yük JS'ine GİRMEMELİ: istemci bileşenleri statik import ETMEZ
 *   (sözleşme: src/lib/contact-input-contract.test.ts). Hafif ayrıştırma için `@/lib/phone`.
 * - SAKLAMA BİÇİMİ değişmez (TR 05XXXXXXXXX / 0XXXXXXXXXX, yabancı +<E.164>).
 * - Ülke verisi kütüphaneden gelir; burada ülke bilgisi UYDURULMAZ.
 */

import { AsYouType, isValidPhoneNumber, validatePhoneNumberLength, type CountryCode } from "libphonenumber-js/min";
import {
  capNational,
  formatTurkishPhone,
  groupNationalDigits,
  parsePhone,
  PHONE_ERROR_MESSAGE,
  type ParsedPhone,
} from "./phone";
import { DEFAULT_PHONE_COUNTRY, getPhoneCountry, matchPhoneCountry } from "./phone-countries";

/** Giriş alanında rakamın yanında izin verilen işaretler dışındaki karakterler (harf, sembol). */
const DISALLOWED_CHARS = /[^\d\s+().\-/]/;

function asCountry(iso: string): CountryCode {
  return iso as CountryCode;
}

/** Ülkenin numaralandırma planına göre geçerli mi (ulusal rakamlar, trunk 0'sız). Kütüphane ülkeyi bilmiyorsa null. */
export function isValidNationalNumber(iso: string, national: string): boolean | null {
  try {
    return isValidPhoneNumber(national, asCountry(iso));
  } catch {
    return null;
  }
}

/** '+<kod><ulusal>' numarası ülkenin planına göre geçerli mi (ülke tablosu dışı kodlar dahil). */
export function isValidE164(e164: string): boolean {
  try {
    return isValidPhoneNumber(e164);
  } catch {
    return false;
  }
}

/**
 * SUNUCU DOĞRULAYICISI. `parsePhone` ile aynı imza ve aynı `stored` çıktısı; ek olarak ülkenin gerçek
 * numaralandırma planına uymayan numarayı (var olmayan alan kodu, fazla/eksik hane) reddeder.
 * Türkiye'de ulusal numara tam 10 hane (cep 5XX, sabit 2/3/4XX, 850); 11+ hane ve harf reddedilir.
 */
export function parsePhoneStrict(
  input: string | null | undefined,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): ParsedPhone {
  const p = parsePhone(input, defaultCountry);
  if (!p.ok) return p;
  if (!isValidE164(p.e164)) {
    const name = p.country ? getPhoneCountry(p.country)?.ad : undefined;
    return {
      ok: false,
      country: p.country,
      e164: "",
      national: "",
      stored: "",
      error: name ? `${name} için geçerli bir numara girin` : PHONE_ERROR_MESSAGE,
    };
  }
  return p;
}

export function isValidPhoneStrict(
  input: string | null | undefined,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): boolean {
  return parsePhoneStrict(input, defaultCountry).ok;
}

/**
 * Ulusal rakamları ülkenin EN UZUN olası uzunluğuna kırpar (TOO_LONG olduğu sürece sondan atar).
 * Önce tablo sınırı (`capNational`), sonra kütüphane sınırı; TR için mevcut 0'lı 11 hane maskesi.
 */
export function capNationalStrict(iso: string, digits: string): string {
  let d = capNational(iso, digits);
  if (iso === "TR") return d;
  try {
    while (d.length > 0 && validatePhoneNumberLength(d, asCountry(iso)) === "TOO_LONG") d = d.slice(0, -1);
  } catch {
    // kütüphane ülkeyi bilmiyor: tablo sınırı yeter
  }
  return d;
}

/** Yazarken biçimlendirme: TR "0544 463 46 44"; diğer ülkeler AsYouType (ülkeye göre gruplama), olmazsa genel gruplama. */
export function formatNationalLive(iso: string, digits: string): string {
  if (!digits) return "";
  if (iso === "TR") return formatTurkishPhone(digits);
  try {
    const out = new AsYouType(asCountry(iso)).input(digits);
    // Kütüphane ulusal ön ek ekleyip rakam sayısını değiştirirse alanı bozmamak için genel gruplama.
    if (out.replace(/\D/g, "") === digits) return out;
  } catch {
    // genel gruplamaya düşer
  }
  return groupNationalDigits(digits);
}

/** Ülkenin izin verdiği en fazla ulusal rakam sayısı (trunk 0'sız); bilinmiyorsa null. */
export function maxNationalDigits(iso: string): number | null {
  if (iso === "TR") return 10;
  const capped = capNationalStrict(iso, "9".repeat(20));
  return capped.length > 0 ? capped.length : null;
}

export type PhoneEntryResult = {
  country: string;
  /** TR: 0'lı en çok 11 hane; yabancı: trunk 0'sız ulusal rakamlar. */
  digits: string;
  /** Henüz tamamlanmamış '+4' gibi ülke kodu taslağı (rakamlar). */
  pending: string | null;
  /** Fazla haneler kırpıldı (arayüz sessiz kalmaz, uyarı gösterir). */
  trimmed: boolean;
  /** Harf/sembol yazıldı ve atıldı. */
  rejectedChars: boolean;
  /** Ülkenin en fazla ulusal hane sayısı (uyarı metni için), bilinmiyorsa null. */
  maxDigits: number | null;
};

/**
 * Giriş alanı için SIKI canlı yorum (yapıştırma/otomatik doldurma dahil): ülke algılama, ülkeye özel
 * maksimum uzunluk, harf reddi ve kırpma bilgisi. `interpretPhoneEntry`in sıkı karşılığıdır.
 */
export function interpretPhoneEntryStrict(raw: string, current: string = DEFAULT_PHONE_COUNTRY): PhoneEntryResult {
  const rejectedChars = DISALLOWED_CHARS.test(raw);
  const t = raw.replace(/[^\d\s+().\-/]/g, "").trim();
  const all = t.replace(/\D/g, "");
  let intl: string | null = null;
  if (t.startsWith("+")) intl = all;
  else if (all.startsWith("00") && all.length > 2) intl = all.slice(2);
  else if (current === "TR" && all.startsWith("90") && all.length >= 12) intl = all;

  if (intl !== null) {
    const c = matchPhoneCountry(intl);
    if (!c) {
      return { country: current, digits: "", pending: intl.slice(0, 15), trimmed: false, rejectedChars, maxDigits: null };
    }
    const nationalRaw = intl.slice(c.dial.length);
    const digits = capNationalStrict(c.iso, nationalRaw);
    const stripped = nationalRaw.replace(/^0+/, "").length;
    const rawLen = c.iso === "TR" ? stripped + 1 : stripped;
    return {
      country: c.iso,
      digits,
      pending: null,
      trimmed: digits.length < rawLen,
      rejectedChars,
      maxDigits: maxNationalDigits(c.iso),
    };
  }

  const digits = capNationalStrict(current, all);
  const rawLen = current === "TR" ? (all.startsWith("0") ? all.length : all.length + 1) : all.replace(/^0+/, "").length;
  return {
    country: current,
    digits,
    pending: null,
    trimmed: all.length > 0 && digits.length < rawLen,
    rejectedChars,
    maxDigits: maxNationalDigits(current),
  };
}
