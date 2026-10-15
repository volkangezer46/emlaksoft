/**
 * Parola politikası — kayıt, şifre yenileme ve parola değiştirme TEK kuralı paylaşır (sunucu + istemci, yan etkisiz).
 *
 * NEDEN BÖYLE: NIST SP 800-63B'nin önerdiği gibi karmaşıklık dayatmak (büyük harf + sembol zorunlu) yerine
 *   1) makul alt sınır (8) ve üst sınır (128; bcrypt 72 bayttan uzununu keser, uyarı verilmez),
 *   2) sızıntı listelerinde en sık görülen ve Türkiye'ye özgü tahmin edilebilir parolaların reddi
 *      (takım adları + kuruluş yılları, şehirler, "sifre123", klavye dizileri),
 *   3) parolada kişinin e-postası, adı veya ofis adının geçmemesi
 * uygulanır. Liste kasıtlı olarak kısadır (istemci paketi küçük kalsın); ezber listeyi tamamlayan asıl koruma,
 * normalize edip sondaki rakam/sembolü atan "kök kelime" kontrolüdür ("Galatasaray1905!" → "galatasaray").
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordContext = {
  email?: string | null;
  fullName?: string | null;
  officeName?: string | null;
};

export type PasswordPolicyIssue =
  | "too_short"
  | "too_long"
  | "common"
  | "sequence"
  | "contains_email"
  | "contains_name"
  | "contains_office";

export type PasswordPolicyResult = { ok: true } | { ok: false; issue: PasswordPolicyIssue; message: string };

const MESSAGES: Record<PasswordPolicyIssue, string> = {
  too_short: `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`,
  too_long: `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`,
  common: "Bu şifre çok yaygın ve kolay tahmin edilir. Size özel, daha uzun bir şifre seçin.",
  sequence: "Şifre ardışık veya tekrar eden karakterlerden oluşamaz (ör. 12345678, aaaaaaaa, qwerty).",
  contains_email: "Şifreniz e-posta adresinizi içeremez.",
  contains_name: "Şifreniz adınızı veya soyadınızı içeremez.",
  contains_office: "Şifreniz ofis adınızı içeremez.",
};

/**
 * Yaygın / zayıf parola kökleri (normalize edilmiş: küçük harf, Türkçe karakterler ASCII, yalnız harf-rakam).
 * Sondaki rakam ve semboller atıldıktan sonra kök bu listedeyse parola reddedilir.
 */
const COMMON_ROOTS = new Set([
  // Global sızıntı listelerinin başı
  "password", "passw0rd", "parola", "sifre", "sifrem", "sifre1", "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl",
  "zxcvbnm", "azerty", "abc", "abcd", "abcdef", "abcdefgh", "iloveyou", "admin", "administrator", "welcome",
  "letmein", "monkey", "dragon", "master", "football", "baseball", "superman", "batman", "princess", "sunshine",
  "starwars", "login", "user", "test", "guest", "root", "changeme", "default", "secret", "trustno", "whatever",
  "freedom", "hello", "shadow", "michael", "jennifer", "computer", "internet", "samsung", "iphone", "google",
  "qazwsx", "qwe", "qweasd", "qweasdzxc", "zaq", "q1w2e3r4", "q1w2e3r4t5", "a1b2c3d4", "1q2w3e4r", "1q2w3e4r5t",
  // Türkiye'ye özgü
  "sifreniz", "parolam", "giris", "girisyap", "deneme", "denemesifre", "yenisifre", "gizli", "gizlisifre",
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor", "bursaspor", "gs", "fb", "bjk", "ts", "cimbom",
  "aslan", "kartal", "kanarya", "turkiye", "turkey", "istanbul", "ankara", "izmir", "antalya", "bursa", "adana",
  "konya", "kocaeli", "mersin", "eskisehir", "trabzon", "ataturk", "mustafakemal", "bismillah", "allah", "allahim",
  "elhamdulillah", "masallah", "inshallah", "insallah", "askim", "askimsin", "sevgilim", "canim", "bebegim",
  "hayatim", "annem", "babam", "kardesim", "ailem", "seniseviyorum", "sevgi", "mehmet", "ahmet", "mustafa",
  "ali", "ayse", "fatma", "emine", "hatice", "zeynep", "elif", "can", "murat", "emre", "burak", "huseyin",
  "hasan", "ibrahim", "ismail", "osman", "yusuf", "omer", "merve", "ozge", "kemal", "selim",
  "emlak", "emlakci", "emlakofisi", "emlaksoft", "gayrimenkul", "konut", "satilik", "kiralik", "tapu", "ofis",
  "remax", "century", "coldwell", "turyap", "sahibinden", "hepsiemlak", "zingat", "emlakjet",
]);

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "qwertzuiop", "azertyuiop"];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "01234567890";

/** Küçük harf + Türkçe karakterlerden ASCII'ye (ı→i, ş→s ...) + yalnız harf/rakam. */
export function normalizePasswordText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

/** Leet-speak sadeleştirme (p@ssw0rd → password) — yalnız kök kontrolünde kullanılır. */
function unleet(value: string): string {
  return value
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s")
    .replace(/@/g, "a");
}

function isSequenceOrRepeat(normalized: string): boolean {
  if (normalized.length === 0) return true;
  if (new Set(normalized).size <= 2) return true; // aaaaaaaa, abababab, 11112222
  for (const source of [...KEYBOARD_ROWS, ALPHABET, DIGITS]) {
    const reversed = [...source].reverse().join("");
    if (source.includes(normalized) || reversed.includes(normalized)) return true;
  }
  // Tekrarlanan kısa blok: "abcabcabc", "12341234"
  for (let size = 1; size <= Math.floor(normalized.length / 2); size++) {
    if (normalized.length % size !== 0) continue;
    const block = normalized.slice(0, size);
    if (block.repeat(normalized.length / size) === normalized) return true;
  }
  return false;
}

/** Sondaki/öndeki rakamları (yıl, 123, 1905 ...) atarak kökü çıkarır. */
function stripDigitAffixes(value: string): string {
  return value.replace(/^\d+/, "").replace(/\d+$/, "");
}

function isCommon(raw: string, normalized: string): boolean {
  const candidates = new Set<string>();
  const leetSource = raw.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9@$ığüşöç]/g, "");
  for (const value of [normalized, stripDigitAffixes(normalized), normalizePasswordText(unleet(leetSource))]) {
    if (value) candidates.add(value);
    const stripped = stripDigitAffixes(value);
    if (stripped) candidates.add(stripped);
  }
  for (const candidate of candidates) {
    if (COMMON_ROOTS.has(candidate)) return true;
    // Kök tamamen tekrar/dizi ise de yaygın sayılır ("abc123", "qwe123").
    if (candidate.length >= 1 && candidate !== normalized && isSequenceOrRepeat(candidate) && candidate.length <= 6) {
      return true;
    }
  }
  // Tekrarlanan yaygın kök: "sifresifre", "galatasaraygalatasaray"
  const root = stripDigitAffixes(normalized);
  for (let size = 2; size <= Math.floor(root.length / 2); size++) {
    if (root.length % size !== 0) continue;
    const block = root.slice(0, size);
    if (block.repeat(root.length / size) === root && COMMON_ROOTS.has(block)) return true;
  }
  return false;
}

/** E-posta yerel kısmı ve alan adı etiketlerinden (gmail/hotmail gibi genel sağlayıcılar hariç) kontrol parçaları. */
const GENERIC_MAIL_LABELS = new Set(["gmail", "hotmail", "outlook", "yahoo", "yandex", "icloud", "live", "mail", "msn", "com", "net", "org", "tr", "co", "info"]);

function emailParts(email: string): string[] {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  const parts = [normalizePasswordText(local), ...local.split(/[._+-]+/).map(normalizePasswordText)];
  for (const label of domain.split(".")) {
    const n = normalizePasswordText(label);
    if (!GENERIC_MAIL_LABELS.has(n)) parts.push(n);
  }
  return parts.filter((p) => p.length >= 4);
}

/** Ad/ofis adından anlamlı kelimeler (ofis adında "emlak", "gayrimenkul" gibi genel ekler zaten yaygın listede). */
const GENERIC_OFFICE_WORDS = new Set(["emlak", "gayrimenkul", "insaat", "yatirim", "danismanlik", "ofisi", "ofis", "real", "estate", "ltd", "sti", "limited", "sirketi", "ve"]);

function nameParts(value: string, minLength: number, skip?: Set<string>): string[] {
  const words = value
    .split(/[\s,.;:/&()'"-]+/)
    .map(normalizePasswordText)
    .filter((w) => w.length >= minLength && !(skip?.has(w)));
  const joined = normalizePasswordText(value);
  if (joined.length >= minLength && !(skip?.has(joined))) words.push(joined);
  return words;
}

/**
 * Parolayı politikaya göre denetler. İlk ihlal Türkçe ve resmi ("siz") bir cümleyle döner.
 * Bağlam verilmezse (ör. giriş öncesi istemci kontrolü) yalnız uzunluk/yaygınlık kuralları uygulanır.
 */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): PasswordPolicyResult {
  const fail = (issue: PasswordPolicyIssue): PasswordPolicyResult => ({ ok: false, issue, message: MESSAGES[issue] });
  if (password.length < PASSWORD_MIN_LENGTH) return fail("too_short");
  if (password.length > PASSWORD_MAX_LENGTH) return fail("too_long");

  const normalized = normalizePasswordText(password);
  if (isSequenceOrRepeat(normalized)) return fail("sequence");
  if (isCommon(password, normalized)) return fail("common");

  if (context.email) {
    for (const part of emailParts(context.email)) {
      if (normalized.includes(part)) return fail("contains_email");
    }
  }
  if (context.fullName) {
    for (const part of nameParts(context.fullName, 3)) {
      if (normalized.includes(part)) return fail("contains_name");
    }
  }
  if (context.officeName) {
    for (const part of nameParts(context.officeName, 4, GENERIC_OFFICE_WORDS)) {
      if (normalized.includes(part)) return fail("contains_office");
    }
  }
  return { ok: true };
}

/** Kısayol: hata mesajı ya da null. */
export function passwordPolicyError(password: string, context: PasswordContext = {}): string | null {
  const result = checkPasswordPolicy(password, context);
  return result.ok ? null : result.message;
}
