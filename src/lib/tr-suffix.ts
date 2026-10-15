/**
 * Türkçe ek seçici (B194): sayı ve özel adlardan sonra kesme işaretli ek, okunuşa göre seçilir.
 * Sayıda ek, sayının SÖYLENİŞİNİN son kelimesine uyar: %100'ü (yüz), %16'sı (altı), %0'ı (sıfır), %40'ı (kırk).
 * Özel adda son ünlü ve son ses: Sahibinden'de, Hepsiemlak'ta, Emlakjet'te.
 * Saf modül (istemci ve sunucu). Sabit "'i/'te" yazmak yasaktır (`tr-suffix-contract.test.ts`).
 */

const UNITS = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"] as const;
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"] as const;
const BIG = ["", "bin", "milyon", "milyar", "trilyon"] as const;

const VOWELS = "aeıioöuüAEIİOÖUÜ";
const HARD = "fstkçşhpFSTKÇŞHP";

/** Sayının okunuşundaki SON kelime (ekin uyacağı kelime). Ondalıkta (`12,5`) ondalık kısmın son kelimesi. */
export function lastSpokenWord(value: number | string): string {
  const text = String(value).trim().replace(/[^\d.,]/g, "");
  // Türkçe biçim: binlik "." ve ondalık ","; ondalık varsa ek ondalık kısma uyar.
  const parts = text.split(",");
  const digits = (parts.length > 1 && parts[parts.length - 1] ? parts[parts.length - 1] : parts[0]).replace(/\D/g, "");
  const n = digits.replace(/^0+/, "");
  if (!n) return "sıfır";
  // Sağdan ilk sıfır olmayan basamak: ilk üçlükteyse birim/onluk/"yüz"; daha üst üçlükteyse o üçlüğün adı
  // (2.000 "iki bin", 20.000 "yirmi bin", 3.000.000 "üç milyon") en son söylenir.
  const rev = n.split("").reverse();
  const i = rev.findIndex((c) => c !== "0");
  const d = Number(rev[i]);
  const group = Math.floor(i / 3);
  if (group > 0) return BIG[group] ?? "trilyon";
  if (i === 0) return UNITS[d];
  if (i === 1) return TENS[d];
  return "yüz";
}

function lastVowel(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) if (VOWELS.includes(word[i])) return word[i].toLocaleLowerCase("tr-TR");
  return "e";
}

function endsWithVowel(word: string): boolean {
  return word.length > 0 && VOWELS.includes(word[word.length - 1]);
}

/** Dar ünlü (ı/i/u/ü) uyumu. */
function narrow(word: string): string {
  const v = lastVowel(word);
  if (v === "a" || v === "ı") return "ı";
  if (v === "e" || v === "i") return "i";
  if (v === "o" || v === "u") return "u";
  return "ü";
}

/** Geniş ünlü (a/e) uyumu. */
function wide(word: string): string {
  const v = lastVowel(word);
  return v === "a" || v === "ı" || v === "o" || v === "u" ? "a" : "e";
}

function spoken(value: number | string): string {
  return typeof value === "number" || /^[\d.,\s]+$/.test(String(value)) ? lastSpokenWord(value) : String(value).trim();
}

/** 3. tekil iyelik eki (…'ı/'i/'u/'ü, ünlüden sonra 's'): toplamın %16'sı, %100'ü. */
export function possessiveSuffix(value: number | string): string {
  const w = spoken(value);
  return (endsWithVowel(w) ? "s" : "") + narrow(w);
}

/** Belirtme eki (…'ı/'i/'u/'ü, ünlüden sonra 'y'): Fotoğraf 2'yi göster. */
export function accusativeSuffix(value: number | string): string {
  const w = spoken(value);
  return (endsWithVowel(w) ? "y" : "") + narrow(w);
}

/** Bulunma eki (…'da/'de/'ta/'te): Sahibinden'de, Hepsiemlak'ta, Emlakjet'te. */
export function locativeSuffix(value: number | string): string {
  const w = spoken(value);
  const hard = w.length > 0 && HARD.includes(w[w.length - 1]);
  return (hard ? "t" : "d") + wide(w);
}

/** Yönelme eki (…'a/'e, ünlüden sonra 'y'): 1.308 lira'ya → para birimi için `moneyDative`. */
export function dativeSuffix(value: number | string): string {
  const w = spoken(value);
  return (endsWithVowel(w) ? "y" : "") + wide(w);
}

/** `%16'sı`, `%100'ü` — yüzdenin iyelik biçimi (… toplamın %X'i). */
export function pctPossessive(pct: number): string {
  return `%${pct}'${possessiveSuffix(pct)}`;
}

/** `Sahibinden'de` — özel adın bulunma biçimi. */
export function withLocative(name: string): string {
  return `${name}'${locativeSuffix(name)}`;
}

/** `2'yi` — sayının belirtme biçimi. */
export function withAccusative(value: number | string): string {
  return `${value}'${accusativeSuffix(value)}`;
}
