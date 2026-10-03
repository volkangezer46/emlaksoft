/**
 * Telefon numarası standardı (varsayılan ülke Türkiye, yabancı numaralar desteklenir).
 *
 * SAKLAMA BİÇİMİ ("stored", geriye uyumlu):
 *   Türkiye cep   -> 05XXXXXXXXX   (11 hane)
 *   Türkiye sabit -> 0XXXXXXXXXX   (11 hane; 2/3/4 ile başlayan alan kodu veya 850)
 *   Yabancı       -> +<E.164>      (örn. +4915123456789)
 * Tüm DB kayıtları ve iç mantık bu biçimi kullanır; dış servislere (WhatsApp, iyzico)
 * gönderilirken E.164/msisdn biçimine anlık çevrilir.
 */

import { DEFAULT_PHONE_COUNTRY, getPhoneCountry, matchPhoneCountry, type PhoneCountry } from "./phone-countries";

const MOBILE_RE = /^05\d{9}$/;

/**
 * Yabancı (Türkiye dışı) uluslararası numara mı? '+49…' veya '0049…' biçimi ve ülke kodu 90 değil.
 * Dönüş: yalnız rakamlar (ülke kodu dahil, '+'sız), değilse null. Uzunluk 7–15 (E.164) değilse null.
 */
function foreignDigits(input: string | null | undefined): string | null {
  const t = (input ?? "").trim();
  let digits: string;
  if (t.startsWith("+")) digits = t.replace(/\D/g, "");
  else if (/^00\d/.test(t.replace(/[\s().-]/g, ""))) digits = t.replace(/\D/g, "").slice(2);
  else return null;
  if (!digits || digits.startsWith("90") || digits.startsWith("0")) return null;
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/**
 * Her türlü girdiyi (boşluklu, +90'lı, 90'lı, 10 haneli) 05XXXXXXXXX'e normalize eder.
 * Yabancı numara (+49…, 0049…) bozulmadan '+<E.164>' olarak döner.
 */
export function normalizeTurkishPhone(input: string | null | undefined): string {
  const foreign = foreignDigits(input);
  if (foreign) return `+${foreign}`;
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

/** E.164: 05XXXXXXXXX -> +905XXXXXXXX (WhatsApp/iyzico/SMS entegrasyonları için). Yabancı numara aynen +E.164. */
export function toE164TurkishPhone(input: string | null | undefined): string {
  const foreign = foreignDigits(input);
  if (foreign) return `+${foreign}`;
  const digits = normalizeTurkishPhone(input);
  if (!digits) return "";
  return `+90${digits.slice(1)}`;
}

/** wa.me linki için ülke kodlu, +'sız, boşluksuz format: 905XXXXXXXXX / 4915123456789. */
export function toWhatsAppMsisdn(input: string | null | undefined): string {
  const foreign = foreignDigits(input);
  if (foreign) return foreign;
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

/** Alıcı seçmeden paylaşım linki (wa.me/?text=); mesaj boşsa null. */
export function toWhatsAppShareLink(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  return text ? `https://wa.me/?text=${encodeURIComponent(text)}` : null;
}

export function toTelHref(input: string | null | undefined): string | null {
  const foreign = foreignDigits(input);
  if (foreign) return `tel:+${foreign}`;
  const digits = normalizeTurkishPhone(input);
  if (!digits) return null;
  return `tel:${digits}`;
}

export const TR_MOBILE_PLACEHOLDER = "05XX XXX XX XX";
export const TR_MOBILE_ERROR_MESSAGE = "Geçerli bir cep telefonu girin (05XX XXX XX XX)";

// ---------------------------------------------------------------------------
// Uluslararası telefon (varsayılan ülke Türkiye)
// ---------------------------------------------------------------------------

export const PHONE_ERROR_MESSAGE = "Geçerli bir telefon numarası girin";

export type ParsedPhone = {
  ok: boolean;
  /** ISO ülke; tabloda olmayan ama E.164 biçimine uyan kodlar için null. */
  country: string | null;
  /** '+<ülke kodu><ulusal>' (başarısızsa ""). */
  e164: string;
  /** Ulusal numara: trunk 0 ve ülke kodu olmadan (başarısızsa ""). */
  national: string;
  /** DB'ye yazılacak biçim (başarısızsa ""). */
  stored: string;
  /** TR için "mobile" | "landline"; yabancı için "international". */
  kind?: "mobile" | "landline" | "international";
  error?: string;
};

function fail(error: string, country: string | null = null): ParsedPhone {
  return { ok: false, country, e164: "", national: "", stored: "", error };
}

const KEEP_LEADING_ZERO = new Set(["IT"]);

function finishTurkey(nationalRaw: string): ParsedPhone {
  let national = nationalRaw;
  if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  if (national.length !== 10) return fail("Türkiye numarası 10 haneli olmalı (5XX XXX XX XX)", "TR");
  const first = national[0];
  if (first === "5") {
    return { ok: true, country: "TR", e164: `+90${national}`, national, stored: `0${national}`, kind: "mobile" };
  }
  if (first === "2" || first === "3" || first === "4" || national.startsWith("850")) {
    return { ok: true, country: "TR", e164: `+90${national}`, national, stored: `0${national}`, kind: "landline" };
  }
  return fail("Geçerli bir Türkiye numarası girin (cep 5XX…)", "TR");
}

function finishForeign(country: PhoneCountry, nationalRaw: string): ParsedPhone {
  let national = nationalRaw;
  if (!KEEP_LEADING_ZERO.has(country.iso)) national = national.replace(/^0+/, "");
  if (national.length < country.min || national.length > country.max) {
    return fail(`${country.ad} numarası geçerli uzunlukta değil`, country.iso);
  }
  const e164 = `+${country.dial}${national}`;
  return { ok: true, country: country.iso, e164, national, stored: e164, kind: "international" };
}

/**
 * Serbest girdiyi ayrıştırıp doğrular.
 * Kabul: 05xx…, 5xx…, 905xx… (12 hane), +90…, 0090…, +49…, 0049…, boşluk/tire/nokta/parantez.
 * Harf içeren girdi reddedilir. '+'sız/'00'suz girdi `defaultCountry` ulusal numarası sayılır.
 * Tabloda olmayan ama 7–15 haneli geçerli E.164 kodlar `country: null` ile kabul edilir.
 */
export function parsePhone(
  input: string | null | undefined,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): ParsedPhone {
  const t = (input ?? "").trim();
  if (!t) return fail("Telefon numarası girin");
  if (/[^\d\s+().\-/]/.test(t) || (t.includes("+") && !t.startsWith("+"))) {
    return fail("Telefon numarası yalnız rakam içermeli");
  }
  const all = t.replace(/\D/g, "");
  if (!all) return fail("Telefon numarası girin");

  let intl: string | null = null;
  if (t.startsWith("+")) intl = all;
  else if (all.startsWith("00")) intl = all.slice(2);
  else if (defaultCountry === "TR" && all.startsWith("90") && all.length === 12) intl = all;

  if (intl !== null) {
    if (!intl || intl.startsWith("0")) return fail("Ülke kodu geçersiz");
    if (intl.length < 7 || intl.length > 15) return fail("Numara uluslararası biçimde 7–15 haneli olmalı");
    const c = matchPhoneCountry(intl);
    if (!c) {
      return { ok: true, country: null, e164: `+${intl}`, national: intl, stored: `+${intl}`, kind: "international" };
    }
    const rest = intl.slice(c.dial.length);
    return c.iso === "TR" ? finishTurkey(rest) : finishForeign(c, rest);
  }

  const def = getPhoneCountry(defaultCountry) ?? getPhoneCountry(DEFAULT_PHONE_COUNTRY)!;
  if (def.iso === "TR") return finishTurkey(all);
  return finishForeign(def, all);
}

export function isValidPhone(input: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): boolean {
  return parsePhone(input, defaultCountry).ok;
}

/** Boşsa geçerli, doluysa geçerli telefon zorunlu. */
export function isValidOptionalPhone(
  input: string | null | undefined,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): boolean {
  if (!(input ?? "").trim()) return true;
  return isValidPhone(input, defaultCountry);
}

/** Geçerliyse saklama biçimi, değilse normalizeTurkishPhone sonucu (eski davranış). */
export function normalizePhone(input: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): string {
  const p = parsePhone(input, defaultCountry);
  return p.ok ? p.stored : normalizeTurkishPhone(input);
}

/** E.164 ('+' dahil); geçersizse "". */
export function toE164Phone(input: string | null | undefined, defaultCountry: string = DEFAULT_PHONE_COUNTRY): string {
  return parsePhone(input, defaultCountry).e164;
}

/** Ulusal rakamları (trunk 0'sız) okunur gruplar: 151 2345 6789, 212 555 1234. */
export function groupNationalDigits(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length <= 3) return d;
  const head = d.slice(0, 3);
  const rest = d.slice(3);
  const parts: string[] = [];
  if (d.length === 10) parts.push(rest.slice(0, 3), rest.slice(3));
  else for (let i = 0; i < rest.length; i += 4) parts.push(rest.slice(i, i + 4));
  return [head, ...parts].join(" ");
}

/**
 * Görüntüleme: Türkiye "0532 123 45 67", yabancı "+49 151 2345 6789".
 * Çözümlenemeyen girdi kırpılmış hâliyle döner.
 */
export function formatPhoneDisplay(stored: string | null | undefined): string {
  const t = (stored ?? "").trim();
  if (!t) return "";
  const p = parsePhone(t);
  if (!p.ok) return t;
  if (p.country === "TR") return formatTurkishPhone(p.stored);
  const dial = p.country ? getPhoneCountry(p.country)!.dial : "";
  const national = dial ? p.e164.slice(1 + dial.length) : p.national;
  return `+${dial ? `${dial} ` : ""}${groupNationalDigits(national)}`;
}

/** Ülkeye göre ulusal rakamları temizler/sınırlar (TR: 0'lı 11 hane, mevcut maske). */
export function capNational(iso: string, digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (iso === "TR") {
    if (d.startsWith("90") && d.length >= 12) return sanitizeTurkishPhoneInput(`0${d.slice(2)}`);
    return sanitizeTurkishPhoneInput(d);
  }
  const c = getPhoneCountry(iso);
  const trimmed = KEEP_LEADING_ZERO.has(iso) ? d : d.replace(/^0+/, "");
  return trimmed.slice(0, c?.max ?? 15);
}

/**
 * Giriş alanı için canlı yorum: ham metinden (yapıştırma/otomatik doldurma dahil) ülke + ulusal rakamlar.
 * TR için `digits` mevcut maskeye uygun 0'lı biçimdir (0532…); yabancı için trunk 0'sız ulusal rakamlar.
 * '+'/'00' ile başlayan girdide ülke otomatik algılanır; kod henüz tamamlanmadıysa `pending` doludur
 * (rakamlar, '+'sız) ve çağıran bunu taslak olarak göstermelidir.
 */
export function interpretPhoneEntry(
  raw: string,
  current: string = DEFAULT_PHONE_COUNTRY,
): { country: string; digits: string; pending: string | null } {
  const t = raw.trim();
  const all = t.replace(/\D/g, "");
  let intl: string | null = null;
  if (t.startsWith("+")) intl = all;
  else if (all.startsWith("00") && all.length > 2) intl = all.slice(2);
  else if (current === "TR" && all.startsWith("90") && all.length >= 12) intl = all;

  if (intl !== null) {
    const c = matchPhoneCountry(intl);
    if (!c) return { country: current, digits: "", pending: intl.slice(0, 15) };
    return { country: c.iso, digits: capNational(c.iso, intl.slice(c.dial.length)), pending: null };
  }
  return { country: current, digits: capNational(current, all), pending: null };
}
