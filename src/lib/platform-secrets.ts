import { createHmac, hkdfSync } from "node:crypto";
import { decryptPii, encryptPii, parsePiiKey } from "@/lib/advisor/pii-crypto";

/**
 * Platform sırlarının (üçüncü taraf API anahtarları) `platform_settings` içinde UYGULAMA KATMANI şifrelemesi.
 * Aynı AES-256-GCM kalıbı (`advisor/pii-crypto.ts`).
 *
 * ŞİFRELEME ANAHTARI (öncelik sırası):
 *  1. `PLATFORM_SECRETS_KEY` (64 hex karakter VEYA 32 baytlık base64) — ÖNERİLEN, ayrı ve döndürülebilir.
 *  2. YEDEK: canlıda zaten zorunlu olan bir sunucu sırrından HKDF-SHA256 ile alan-ayrımlı TÜRETİLMİŞ anahtar
 *     (`OTP_HMAC_SECRET`, yoksa `TWO_FACTOR_COOKIE_SECRET`, yoksa `PROPERTY_MEDIA_SIGNING_SECRET`).
 *     Kaynak sırrın kendisi şifrelemede kullanılmaz; yalnız bu amaca özgü (`info`) türetilmiş anahtar kullanılır.
 * Hiçbiri yoksa özellik KAPALIDIR: düz metin ASLA yazılır.
 *
 * ÇÖZME: tüm adayları (env + türetilmişler) sırayla dener. Böylece sonradan `PLATFORM_SECRETS_KEY` eklenirse
 * türetilmiş anahtarla yazılmış eski kayıtlar çözülmeye devam eder; yeni yazımlar önce env anahtarıyla yapılır.
 * UYARI: yedek anahtarın kaynağı olan sır DÖNDÜRÜLÜRSE o kayıt çözülemez; admin anahtarı yeniden girer.
 *
 * AAD = `platform_settings:<ayar anahtarı>`: şifreli değer başka bir ayar satırına taşınırsa çözülmez.
 * Saklama biçimi: `v1.<iv>.<tag>.<şifreli>` (base64url). Sunucuya özel (node:crypto).
 */

export const PLATFORM_SECRETS_DISABLED_MESSAGE = "etkin değil: PLATFORM_SECRETS_KEY tanımlı değil";

/** Türetme kaynakları (canlıda zorunlu sunucu sırları), öncelik sırasıyla. */
export const PLATFORM_SECRETS_DERIVE_SOURCES = [
  "OTP_HMAC_SECRET",
  "TWO_FACTOR_COOKIE_SECRET",
  "PROPERTY_MEDIA_SIGNING_SECRET",
] as const;

const MIN_SOURCE_SECRET_LENGTH = 24;
const HKDF_SALT = "emlaksoft:platform-secrets:salt:v1";
const HKDF_INFO = "emlaksoft/platform-secrets/v1";

export type PlatformSecretsKeySource = "env" | "derived" | "none";

function derivedKeys(): Buffer[] {
  const out: Buffer[] = [];
  for (const name of PLATFORM_SECRETS_DERIVE_SOURCES) {
    const secret = process.env[name]?.trim();
    if (!secret || secret.length < MIN_SOURCE_SECRET_LENGTH) continue;
    out.push(Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32)));
  }
  return out;
}

/** Sıralı aday anahtarlar: önce env, sonra türetilmişler. İlk eleman yeni yazımlarda kullanılır. */
function candidateKeys(): Buffer[] {
  const env = parsePiiKey(process.env.PLATFORM_SECRETS_KEY);
  return env ? [env, ...derivedKeys()] : derivedKeys();
}

export function getPlatformSecretsKey(): Buffer | null {
  return candidateKeys()[0] ?? null;
}

export function platformSecretsEnabled(): boolean {
  return getPlatformSecretsKey() !== null;
}

/** Yeni yazımda hangi anahtar kullanılır (admin ekranında bilgi için; anahtarın kendisi ASLA dönmez). */
export function platformSecretsKeySource(): PlatformSecretsKeySource {
  if (parsePiiKey(process.env.PLATFORM_SECRETS_KEY)) return "env";
  return derivedKeys().length > 0 ? "derived" : "none";
}

function aad(settingKey: string): Buffer {
  return Buffer.from(`platform_settings:${settingKey}`, "utf8");
}

/** Şifreler; anahtar yoksa null (çağıran KAYDETMEZ). */
export function sealPlatformSecret(settingKey: string, plain: string): string | null {
  const key = getPlatformSecretsKey();
  if (!key) return null;
  return encryptPii(plain, key, aad(settingKey));
}

/** Çözer; hiçbir aday anahtarla çözülmezse/bozuk veri → null. Asla fırlatmaz. */
export function openPlatformSecret(settingKey: string, payload: string | null | undefined): string | null {
  if (!payload) return null;
  for (const key of candidateKeys()) {
    const plain = decryptPii(payload, key, aad(settingKey));
    if (plain !== null) return plain;
  }
  return null;
}

/** Alan-ayrımlı HMAC türetimi (ör. takma kullanıcı referansı). Anahtar yoksa null. */
export function derivePlatformHmac(domain: string, input: string): string | null {
  const key = getPlatformSecretsKey();
  if (!key) return null;
  const sub = createHmac("sha256", key).update(`domain:${domain}`).digest();
  return createHmac("sha256", sub).update(input).digest("hex");
}
