/**
 * Ofis vitrin adresi (tenants.slug) üretimi ve doğrulaması. Saf, yan etkisiz (sunucu + istemci ortak).
 *
 * Veritabanı kuralı (provizyon RPC'leri): `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..48 karakter.
 * Platform yönetiminden elle seçilen adreste alt sınır 3 karakterdir (tek harfli vitrin adresi anlamsız).
 */

export const OFFICE_SLUG_MIN = 3;
export const OFFICE_SLUG_MAX = 48;
export const OFFICE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TR_MAP: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Serbest metni vitrin adresine çevirir: Türkçe karakter dönüşümü (İ/I -> i, ş -> s ...), aksan temizliği,
 * harf/rakam dışı her şey tek tire, baştaki/sondaki tire atılır, en çok 48 karakter (kesim sonrası sondaki
 * tire de atılır: sonuç her zaman RPC kuralına uyar ya da boştur).
 */
export function slugifyOffice(input: string | null | undefined): string {
  const lowered = (input ?? "").toLocaleLowerCase("tr-TR");
  const mapped = Array.from(lowered, (ch) => TR_MAP[ch] ?? ch).join("");
  return mapped
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, OFFICE_SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * Yazarken uygulanan hafif temizlik: `slugifyOffice` gibi dönüştürür ama sondaki tek tireyi korur
 * (kullanıcı "kadikoy-" yazıp devam edebilsin). Kayıtta `validateOfficeSlug` yine de denetler.
 */
export function sanitizeSlugTyping(input: string): string {
  const lowered = input.toLocaleLowerCase("tr-TR");
  const mapped = Array.from(lowered, (ch) => TR_MAP[ch] ?? ch).join("");
  return mapped
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, OFFICE_SLUG_MAX);
}

export type OfficeSlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/** Elle girilen vitrin adresini doğrular (normalize ETMEZ: kullanıcı ne yazdıysa onu denetler). */
export function validateOfficeSlug(raw: string | null | undefined): OfficeSlugCheck {
  const slug = (raw ?? "").trim();
  if (!slug) return { ok: false, error: "Vitrin adresi girin." };
  if (slug.length < OFFICE_SLUG_MIN) return { ok: false, error: `Vitrin adresi en az ${OFFICE_SLUG_MIN} karakter olmalı.` };
  if (slug.length > OFFICE_SLUG_MAX) return { ok: false, error: `Vitrin adresi en çok ${OFFICE_SLUG_MAX} karakter olabilir.` };
  if (!OFFICE_SLUG_RE.test(slug)) {
    return { ok: false, error: "Vitrin adresi yalnız küçük harf, rakam ve tire içerebilir (Türkçe karakter ve boşluk olmaz)." };
  }
  return { ok: true, slug };
}

/**
 * Adres doluysa önerilecek alternatifler (benzersizlik sunucuda ayrıca denetlenir).
 * Şehir verilirse önce `<adres>-<sehir>`, ardından sıra numaralı adaylar.
 */
export function officeSlugCandidates(base: string, city?: string | null, count = 4): string[] {
  const root = slugifyOffice(base);
  if (!root) return [];
  const out: string[] = [];
  const push = (candidate: string) => {
    const s = slugifyOffice(candidate);
    if (s && s !== root && s.length >= OFFICE_SLUG_MIN && !out.includes(s)) out.push(s);
  };
  const citySlug = slugifyOffice(city ?? "");
  if (citySlug && !root.endsWith(citySlug)) push(`${root.slice(0, OFFICE_SLUG_MAX - citySlug.length - 1)}-${citySlug}`);
  for (let n = 2; out.length < count && n < count + 6; n += 1) {
    const suffix = `-${n}`;
    push(`${root.slice(0, OFFICE_SLUG_MAX - suffix.length)}${suffix}`);
  }
  return out.slice(0, count);
}

/**
 * Demo dönüşüm action'ının (platform-sales.ts `slugify`) ürettiği adres tabanının AYNISI.
 * Atomik provizyon RPC'si tabanı o action'dan alır; burada yalnız "RPC bu adı kabul eder mi" sorusu
 * için yeniden hesaplanır (kesim sondaki tireyi bırakabildiğinden uzun adlarda RPC reddeder).
 */
export function legacyProvisionSlugBase(company: string): string {
  return company
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Provizyon RPC'sine verilecek ofis adı: tam ad RPC'nin adres kuralını sağlıyorsa aynen döner;
 * sağlamıyorsa (çok uzun ad, tireyle biten kesim) sözcük sınırından kısaltılmış güvenli bir ad döner.
 * Çağıran, kısaltma olduysa provizyondan sonra ofis adını tam haline günceller.
 */
export function provisionSafeCompanyName(name: string): string {
  const full = name.trim().replace(/\s+/g, " ");
  const fits = (candidate: string) => {
    const base = legacyProvisionSlugBase(candidate);
    return base === "" || OFFICE_SLUG_RE.test(base);
  };
  if (fits(full)) return full;
  const words = full.split(" ");
  while (words.length > 1) {
    words.pop();
    const candidate = words.join(" ");
    if (candidate.length >= 2 && fits(candidate)) return candidate;
  }
  // Tek sözcük ve hâlâ uymuyorsa: harf/rakam dışını atıp 40 karaktere indir (RPC alt sınırı 2 karakter).
  const compact = full.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 40);
  return compact.length >= 2 ? compact : "Ofis";
}
