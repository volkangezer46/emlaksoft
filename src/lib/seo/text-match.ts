/**
 * TÜRKÇE METİN EŞLEŞTİRME (SAF, bağımlılıksız; istemci içerik puanı paneli de içe aktarır).
 * Karşılaştırma büyük/küçük harf ve Türkçe harf duyarsızdır (İ/ı/ş/ğ/ç/ö/ü → ASCII); Türkçe ek esnekliği için
 * 5 harften uzun sözcüklerde ilk 5 harf (yaklaşık kök) aranır: "dairesi" ≈ "daire", "kadıköy'de" ≈ "kadıköy".
 */

/** Türkçe duyarlı karşılaştırma biçimi: küçük harf, aksan/Türkçe harf ASCII, harf-rakam dışı boşluk. */
export function foldTr(s: string): string {
  return s
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP = new Set(["ve", "ile", "icin", "bir", "bu", "en", "da", "de", "mi", "ne", "nasil", "nedir", "gibi", "the", "emlaksoft"]);

/** Anlamlı sözcükler (≥3 harf, bağlaç değil). */
export function keyTerms(s: string): string[] {
  return foldTr(s)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** İfadenin anlamlı sözcüklerinin en az %60'ı metinde geçiyor mu (Türkçe ek esnekliği: sözcük kökü ilk 5 harf). */
export function containsPhrase(text: string | null | undefined, phrase: string): boolean {
  if (!text) return false;
  const hay = ` ${foldTr(text)} `;
  const terms = keyTerms(phrase);
  if (terms.length === 0) return false;
  const hit = terms.filter((t) => hay.includes(` ${t.length > 5 ? t.slice(0, 5) : t}`)).length;
  return hit / terms.length >= 0.6;
}

