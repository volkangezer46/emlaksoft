import { createHash, randomInt } from "node:crypto";

/**
 * İmza kanıtı (SP8) — yalnız sunucu (`node:crypto`). İçerik özeti, doğrulama kodu ve imzacı başına kanıt yardımcıları.
 *
 * İçerik özeti normalizasyonu SABİTTİR (testle kilitli): satır sonu CRLF/CR → LF, satır sonu boşlukları atılır, metnin
 * başı/sonu kırpılır, Unicode NFC. Özet = SHA-256( "emlaksoft-contract-v1\n" + başlık + "\n\n" + gövde ).
 * Bu sözleşme metni ekranda/çıktıda nasıl görünürse görünsün aynı özeti üretir; tek karakter değişirse özet değişir.
 *
 * Hukuki not: SMS OTP basit elektronik imzadır; nitelikli elektronik imza (5070 sayılı Kanun) değildir. Bu modül
 * yalnız delil paketi üretir, geçerlilik iddiası yazmaz.
 */

export const CONTRACT_HASH_VERSION = "emlaksoft-contract-v1";

export function normalizeContractText(text: string): string {
  return String(text ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/u, ""))
    .join("\n")
    .trim();
}

export function contractContentSha256(title: string, body: string): string {
  const payload = `${CONTRACT_HASH_VERSION}\n${normalizeContractText(title)}\n\n${normalizeContractText(body)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Crockford base32 (I, L, O, U yok): elle yazımda karışmaz. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const VERIFY_CODE_LENGTH = 12;
const VERIFY_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

/** 12 karakter ≈ 60 bit rastgelelik (kriptografik); tahmin edilemez. */
export function generateVerifyCode(): string {
  let out = "";
  for (let i = 0; i < VERIFY_CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Kullanıcı girdisini kanonik koda çevirir: boşluk/tire atılır, büyük harfe çevrilir, karışan harfler düzeltilir
 * (O→0, I/L→1). Geçersizse null.
 */
export function normalizeVerifyCode(raw: unknown): string | null {
  const cleaned = String(raw ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return VERIFY_CODE_RE.test(cleaned) ? cleaned : null;
}

/** Okunur gösterim: ABCD-EFGH-JKMN. */
export function formatVerifyCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * İmza anındaki IP'nin sözleşmeye tuzlanmış özeti (herkese açık sertifikada ham IP yerine). Ham IP ofis içi kayıtta
 * (`contract_signers.ip_address`) kalır; özet yalnız "aynı IP mi" karşılaştırmasına yarar.
 */
export function signerIpHash(contractId: string, ip: string | null | undefined): string | null {
  const v = String(ip ?? "").trim();
  if (!v) return null;
  return createHash("sha256").update(`ip-v1|${contractId}|${v}`, "utf8").digest("hex");
}

/** User-agent kırpılır (400 karakter, kontrol karakterleri atılır). */
export function cleanUserAgent(ua: string | null | undefined): string | null {
  const v = String(ua ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return v ? v.slice(0, 400) : null;
}

/** Herkese açık sayfada ad maskesi (uzunluk da sızmaz): "Ahmet Yılmaz" → "A*** Y***". */
export function maskPersonName(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "İmzacı";
  return parts.map((p) => `${p.charAt(0).toLocaleUpperCase("tr-TR")}***`).join(" ");
}

/** Telefon maskesi (sertifika): 05321234567 → 0532 *** ** 67. */
export function maskPhoneForCertificate(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `${digits.slice(0, 4)} *** ** ${digits.slice(-2)}`;
}

/** Kısa özet gösterimi: ilk 12 + son 12 karakter. */
export function shortHash(hash: string | null | undefined): string {
  const h = String(hash ?? "");
  return h.length > 28 ? `${h.slice(0, 12)}…${h.slice(-12)}` : h;
}
