import { createHmac } from "node:crypto";
import { decryptPii, encryptPii, parsePiiKey } from "@/lib/advisor/pii-crypto";

/**
 * Platform sırlarının (üçüncü taraf API anahtarları) `platform_settings` içinde UYGULAMA KATMANI şifrelemesi.
 * Aynı AES-256-GCM kalıbı (`advisor/pii-crypto.ts`), ayrı anahtar: `PLATFORM_SECRETS_KEY`
 * (64 hex karakter VEYA 32 baytlık base64). Anahtar yoksa/geçersizse özellik KAPALIDIR: düz metin ASLA yazılmaz.
 *
 * AAD = `platform_settings:<ayar anahtarı>`: şifreli değer başka bir ayar satırına taşınırsa çözülmez.
 * Saklama biçimi: `v1.<iv>.<tag>.<şifreli>` (base64url). Sunucuya özel (node:crypto).
 */

export const PLATFORM_SECRETS_DISABLED_MESSAGE = "etkin değil: PLATFORM_SECRETS_KEY tanımlı değil";

export function getPlatformSecretsKey(): Buffer | null {
  return parsePiiKey(process.env.PLATFORM_SECRETS_KEY);
}

export function platformSecretsEnabled(): boolean {
  return getPlatformSecretsKey() !== null;
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

/** Çözer; anahtar yok/yanlış/bozuk veri → null. Asla fırlatmaz. */
export function openPlatformSecret(settingKey: string, payload: string | null | undefined): string | null {
  const key = getPlatformSecretsKey();
  if (!key || !payload) return null;
  return decryptPii(payload, key, aad(settingKey));
}

/** Alan-ayrımlı HMAC türetimi (ör. takma kullanıcı referansı). Anahtar yoksa null. */
export function derivePlatformHmac(domain: string, input: string): string | null {
  const key = getPlatformSecretsKey();
  if (!key) return null;
  const sub = createHmac("sha256", key).update(`domain:${domain}`).digest();
  return createHmac("sha256", sub).update(input).digest("hex");
}
