import { foldTr } from "@/lib/tr-text";
import { ZEKA_MAX_QUERY } from "./types";

/**
 * Türkçe normalleştirme (SAF). Tek katlama kaynağı `@/lib/tr-text` (`foldTr`: Türkçe küçültme + aksan düzleştirme,
 * "İSTANBUL" → "istanbul", "Iğdır" → "igdir"). Burada yalnız Zeka'nın ek kuralları vardır:
 *  - kesme işaretli ekler atılır ("Kadıköy'deki" → "kadikoy"),
 *  - yaygın çekim ekleri kırpılır (`stemTr`: "müşterileri" → "musteri", "dairesi" → "daire"),
 *  - eşleşme ÖN EK ile yapılır (`matchesLexeme`): Türkçe eklemeli dil olduğundan "randevularım" "randevu" ile eşleşir.
 */

/** Ham girdiyi kırpar: boşluk sadeleşir, üst sınır uygulanır, kontrol karakterleri atılır. */
export function cleanQuery(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ZEKA_MAX_QUERY);
}

/**
 * Katlanmış metin: Türkçe küçük harf + aksansız; kesme işaretinden sonraki ek atılır; para/oda/saat işaretleri korunur
 * ("3+1", "14:00", "5.000.000", "2-4").
 */
export function foldQuery(raw: string): string {
  return foldTr(cleanQuery(raw))
    .replace(/[’‘`´]/g, "'")
    .replace(/([a-z0-9])'[a-z]*/g, "$1")
    .replace(/[^a-z0-9+\-.,:/\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Uzundan kısaya: çoğul + iyelik + hâl + ilgi ekleri (katlanmış biçim). */
const SUFFIXES = [
  "lerimizden", "larimizdan", "lerimizde", "larimizda", "lerimizi", "larimizi", "lerimiz", "larimiz",
  "lerinden", "larindan", "lerinde", "larinda", "lerini", "larini", "lerine", "larina", "lerin", "larin",
  "lerim", "larim", "leri", "lari", "ler", "lar",
  "sinde", "sinda", "sini", "sina", "sine", "sinin", "sunun",
  "imizi", "umuzu", "imiz", "umuz", "imi", "umu",
  "deki", "daki", "teki", "taki",
  "inde", "inda", "unde", "unda", "nde", "nda",
  "den", "dan", "ten", "tan", "nin", "nun",
  "yla", "yle", "yi", "yu", "ya", "ye",
  "si", "su", "de", "da", "te", "ta", "ki", "ku",
];

/** Kaba Türkçe kök: ekler en çok üç tur kırpılır, kök en az 4 harf kalır. Sayı/işaret içeren jeton olduğu gibi döner. */
export function stemTr(word: string): string {
  let w = foldTr(word).replace(/'.*$/, "");
  if (!/^[a-z]+$/.test(w)) return w;
  for (let round = 0; round < 3; round += 1) {
    const suf = SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 4);
    if (!suf) break;
    w = w.slice(0, -suf.length);
  }
  return w;
}

/** Katlanmış sözcük listesi (boşluğa göre; boş jetonlar atılır). */
export function tokens(raw: string): string[] {
  return foldQuery(raw)
    .split(/\s+/)
    .map((t) => t.replace(/^[.,:/-]+|[.,:/-]+$/g, ""))
    .filter(Boolean);
}

/**
 * Jeton bir sözlük öğesiyle eşleşir mi? Eşit; ya da öğe (≥4 harf) jetonun başı ("musterileri" ⊃ "musteri");
 * ya da jeton (≥4 harf) öğenin başı ("randev" → "randevu"). Çok sözcüklü öğe (`"mal sahibi"`) `phraseIn` ile aranır.
 */
export function matchesLexeme(token: string, lexeme: string): boolean {
  if (token === lexeme) return true;
  if (lexeme.length >= 4 && token.startsWith(lexeme)) return true;
  return token.length >= 4 && lexeme.startsWith(token) && lexeme.length - token.length <= 2;
}

/** Katlanmış jeton dizisinde çok sözcüklü ifade geçiyor mu (her sözcük sırayla, ön ek kuralıyla)? */
export function phraseIn(toks: readonly string[], phrase: string): boolean {
  const words = phrase.split(" ");
  if (words.length === 1) return toks.some((t) => matchesLexeme(t, words[0]!));
  for (let i = 0; i + words.length <= toks.length; i += 1) {
    if (words.every((w, j) => matchesLexeme(toks[i + j]!, w))) return true;
  }
  return false;
}

/** Herhangi bir ifade geçiyor mu? */
export function anyPhrase(toks: readonly string[], phrases: readonly string[]): boolean {
  return phrases.some((p) => phraseIn(toks, p));
}
