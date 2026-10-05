/**
 * Coğrafya metin normalizasyonu — SAF (sunucu/istemci ortak, yan etkisiz).
 *
 * Tek kural: ad karşılaştırması, slug üretimi ve yazım toleransı yalnız burada.
 * Türkçe I/İ/ı/i tuzağı `tr-text.foldTr` ile çözülür (İSTANBUL, Iğdır, ıgdır → ascii).
 */
import { foldTr } from "@/lib/tr-text";

export { foldTr as geoFold };

const MAHALLE_SUFFIX = /\s+(mahallesi|mah\.?|mh\.?|koyu|koy)$/;
const ILCE_SUFFIX = /\s+(ilcesi|ilce)$/;
const IL_SUFFIX = /\s+(ili|il|belediyesi)$/;

/** Karşılaştırma anahtarı: katlanmış, noktalama atılmış, ek (mahallesi/ilçesi/ili) kırpılmış. */
export function geoKey(value: string | null | undefined, level?: "province" | "district" | "neighborhood"): string {
  let s = foldTr(value).replace(/[.'’`´"]/g, " ").replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (level === "neighborhood") s = s.replace(MAHALLE_SUFFIX, "");
  else if (level === "district") s = s.replace(ILCE_SUFFIX, "");
  else if (level === "province") s = s.replace(IL_SUFFIX, "");
  return s.trim();
}

/** ASCII slug: "Çankaya Mah." → "cankaya-mah". */
export function geoSlug(value: string | null | undefined): string {
  return foldTr(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Boşluk sadeleştirilmiş görünen ad (kayıt öncesi). */
export function cleanGeoName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Levenshtein mesafesi (üst sınırlı; sınırı aşınca max+1 döner). */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Yazım toleransı: kısa adlarda 0, orta adlarda 1, uzun adlarda 2 harf farkı. */
export function typoBudget(key: string): number {
  if (key.length < 5) return 0;
  return key.length < 9 ? 1 : 2;
}
