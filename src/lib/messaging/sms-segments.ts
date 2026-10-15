/**
 * SMS karakter / parça (kredi) hesabı — SAF modül (istemci ve sunucu güvenle import eder).
 *
 * Üç kodlama:
 *   - gsm7: yalnız GSM 03.38 temel (+ genişletilmiş: 2 septet) karakterler → 160 (çok parçada 153).
 *   - tr:   GSM-7 + Türkçe ulusal dil tablosu (ç ş ğ ı İ Ş Ğ). Netgsm'e `dil="TR"` gönderildiğinde mesaj UCS-2'ye
 *           düşmez; ulusal dil başlığı yer kapladığı için 155 (çok parçada 149) karakter/SMS.
 *   - ucs2: başka herhangi bir karakter (emoji, Arapça, Kiril, akıllı tırnak vb.) → 70 (çok parçada 67).
 * Netgsm teslim raporu boy bildirirse günlükteki değer onunla güncellenir (message-log), bu hesap tahmindir.
 */

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€\f";
/** GSM-7 temel tabloda olmayan, Türkçe ulusal dil tablosuyla tek septet sayılan harfler. */
const TR_NATIONAL = "çşğıİŞĞ";

export type SmsEncoding = "gsm7" | "tr" | "ucs2";

export type SmsInfo = {
  encoding: SmsEncoding;
  /** Kredi hesabındaki birim (GSM-7'de genişletilmiş karakter 2 sayılır). */
  units: number;
  /** Görünen karakter sayısı (kod noktası). */
  chars: number;
  segments: number;
  /** Bu kodlamada tek parçalı mesajın sığabileceği birim. */
  singleLimit: number;
  /** Çok parçalı mesajda parça başı birim. */
  multiLimit: number;
  /** Bulunduğu parçada kalan birim (0 = parça tam dolu). */
  remainingInSegment: number;
};

const LIMITS: Record<SmsEncoding, { single: number; multi: number }> = {
  gsm7: { single: 160, multi: 153 },
  tr: { single: 155, multi: 149 },
  ucs2: { single: 70, multi: 67 },
};

/** Kampanya ve tekil SMS için üst sınır (parça). Netgsm uzun mesajı birleştirir ama maliyet doğrusal artar. */
export const SMS_MAX_SEGMENTS = 4;

export function smsInfo(text: string): SmsInfo {
  let septets = 0;
  let encoding: SmsEncoding = "gsm7";
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXT.includes(ch)) septets += 2;
    else if (TR_NATIONAL.includes(ch)) {
      septets += 1;
      encoding = "tr";
    } else {
      encoding = "ucs2";
      break;
    }
  }
  const chars = [...text].length;
  const units = encoding === "ucs2" ? chars : septets;
  const { single, multi } = LIMITS[encoding];
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi);
  const capacity = segments <= 1 ? single : segments * multi;
  return {
    encoding,
    units,
    chars,
    segments,
    singleLimit: single,
    multiLimit: multi,
    remainingInSegment: Math.max(0, capacity - units),
  };
}

/** Kredi boyu (parça sayısı). */
export function smsSegments(text: string): number {
  return smsInfo(text).segments;
}

/** Metin Netgsm'e Türkçe ulusal dil kodlamasıyla (`dil="TR"`) gönderilmeli mi? */
export function needsTurkishEncoding(text: string): boolean {
  return smsInfo(text).encoding === "tr";
}

const UCS2_SIMPLIFY: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...",
  " ": " ", "â": "a", "Â": "A", "î": "i", "Î": "I", "û": "u", "Û": "U",
};

/**
 * Mesajı UCS-2'ye düşüren yaygın karakterleri (akıllı tırnak, uzun tire, şapkalı â/î/û) GSM/Türkçe karşılığına çevirir.
 * Emoji gibi karşılığı olmayanlara dokunmaz.
 */
export function simplifyForSms(text: string): string {
  let out = "";
  for (const ch of text) out += UCS2_SIMPLIFY[ch] ?? ch;
  return out;
}

/** Türkçe karakterleri ASCII karşılığına indirir (ı→i, ş→s ...): mesaj GSM-7'de 160 karaktere çıkar. */
export function stripTurkishChars(text: string): string {
  const map: Record<string, string> = { ç: "c", ş: "s", ğ: "g", ı: "i", İ: "I", Ş: "S", Ğ: "G" };
  let out = "";
  for (const ch of simplifyForSms(text)) out += map[ch] ?? ch;
  return out;
}

export const SMS_ENCODING_LABEL: Record<SmsEncoding, string> = {
  gsm7: "Standart",
  tr: "Türkçe karakterli",
  ucs2: "Özel karakterli (Unicode)",
};
