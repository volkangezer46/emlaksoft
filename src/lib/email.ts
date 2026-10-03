/**
 * E-posta normalizasyonu ve doğrulaması (pratik RFC 5321/5322 alt kümesi).
 *
 * KARAR (IDN): ALAN ADI Unicode harf içerebilir (müşteri.com.tr gibi IDN alan adları geçerli);
 * YEREL KISIM yalnız ASCII (atext karakterleri, ardışık/baş/son nokta yok) kabul edilir — Türkçe karakterli
 * yerel kısım (EAI) pratikte desteklenmez ve tarayıcı type="email" doğrulamasıyla da uyumsuzdur.
 * Tırnaklı yerel kısım, IP-literal alan ve yorumlar desteklenmez.
 * Sınırlar: toplam ≤254, yerel ≤64, etiket ≤63, alan adında en az bir nokta, TLD ≥2 harf (veya xn--).
 */

const LOCAL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;

/** Kırpar, NFC'ye çevirir, küçük harfe çevirir ('I' -> 'i'; yerel ayardan bağımsız). */
export function normalizeEmail(input: string | null | undefined): string {
  return (input ?? "").normalize("NFC").trim().toLowerCase();
}

export function isValidEmail(input: string | null | undefined): boolean {
  const email = normalizeEmail(input);
  if (!email || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !LOCAL_RE.test(local)) return false;
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => l.length >= 1 && l.length <= 63 && LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1];
  return tld.startsWith("xn--") ? tld.length > 4 : /^\p{L}{2,}$/u.test(tld);
}

/** Boşsa geçerli, doluysa geçerli e-posta zorunlu. */
export function isValidOptionalEmail(input: string | null | undefined): boolean {
  if (!(input ?? "").trim()) return true;
  return isValidEmail(input);
}

export const EMAIL_ERROR_MESSAGE = "Geçerli bir e-posta adresi girin";
