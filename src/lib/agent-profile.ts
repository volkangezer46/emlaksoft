/**
 * Danışman dijital kartviziti (/danisman/[slug]) — paylaşılan saf yardımcılar.
 *
 * Hem server action (doğrulama) hem public sayfa (gösterim) hem panel formu
 * (canlı slug önizlemesi) aynı kuralları kullansın diye tek modülde toplandı.
 */

/** Bio üst sınırı — DB'deki `profiles_bio_len` kısıtıyla aynı olmalı. */
export const AGENT_BIO_MAX = 600;
/** Unvan tek satır kalsın. */
export const AGENT_TITLE_MAX = 60;
/** Çip sayıları — hero şeridi taşmasın, "her şeyde uzmanım" izlenimi oluşmasın. */
export const AGENT_SPECIALTIES_MAX = 8;
export const AGENT_LANGUAGES_MAX = 6;
export const AGENT_CHIP_MAX_LEN = 32;

const TR_MAP: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i", i: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u", â: "a", Â: "a", î: "i", û: "u",
};

/**
 * Ad-soyaddan URL slug'ı türetir: "Ayşe Gül Öztürk" → "ayse-gul-ozturk".
 * DB kısıtı (`^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$`) ile uyumlu çıktı üretir;
 * 3 karakterden kısa kalırsa boş döner (çağıran yer yedek üretir).
 */
export function slugifyAgentName(input: string): string {
  const ascii = (input ?? "")
    .replace(/[çÇğĞıİiöÖşŞüÜâÂîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .toLowerCase()
    .normalize("NFD")
    // Kalan aksanları (é, ñ …) birleştirici işaretlerini atarak sadeleştir.
    .replace(/[\u0300-\u036f]/g, "");
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

/** Slug DB kısıtına uyuyor mu? (action ve form aynı mesajı verebilsin diye) */
export function isValidAgentSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug);
}

/**
 * Çip girişini (virgülle ayrılmış tek alan) temizler: boşları atar, kırpar,
 * büyük/küçük harf duyarsız tekilleştirir, adet ve uzunluk sınırlarını uygular.
 */
export function parseChips(raw: string | null | undefined, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of String(raw ?? "").split(",")) {
    const value = piece.trim().replace(/\s+/g, " ").slice(0, AGENT_CHIP_MAX_LEN);
    if (!value) continue;
    const key = value.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Yorum sahibinin adını KISALTIR: "Ahmet Yılmaz" → "A. Yılmaz".
 * Public sayfada müşteri tam adı gösterilmez (KVKK: veri minimizasyonu).
 */
export function shortenCustomerName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Bir müşteri";
  if (parts.length === 1) return `${parts[0]!.slice(0, 1).toLocaleUpperCase("tr")}.`;
  const first = parts[0]!.slice(0, 1).toLocaleUpperCase("tr");
  return `${first}. ${parts.at(-1)}`;
}

/** Fotoğrafsız profil için baş harf monogramı: "Ayşe Gül" → "AG". */
export function agentInitials(fullName: string | null | undefined): string {
  return String(fullName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr");
}
