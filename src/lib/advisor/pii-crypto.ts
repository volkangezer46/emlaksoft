import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Danışman kimlik verisi (TC kimlik no, IBAN) uygulama katmanı şifrelemesi: AES-256-GCM.
 *
 * - Anahtar `ADVISOR_PII_KEY` ortam değişkenidir (64 hex karakter VEYA 32 baytlık base64). Anahtar yoksa ya da
 *   biçimi geçersizse `getPiiKeyFromEnv()` null döner ve çağıran alanları KAPALI tutar; hiçbir koşulda açık yazılmaz.
 * - Her şifreleme rastgele 12 baytlık IV kullanır; AAD olarak `profileId:alan` bağlanır (şifreli metin başka satıra
 *   veya alana taşınırsa çözülmez).
 * - Saklama biçimi: `v1.<iv>.<tag>.<şifreli>` (base64url). `v1` anahtar sürümüdür (`enc_key_version`).
 * Sunucuya özel (node:crypto) — istemci bileşeninden import edilmez.
 */

import type { PiiField } from "./pii-messages";

export type { PiiField };

export const PII_KEY_VERSION = 1;
export { PII_DISABLED_MESSAGE } from "./pii-messages";

const FORMAT_PREFIX = `v${PII_KEY_VERSION}`;

/** Ham ortam değeri -> 32 baytlık anahtar (geçersizse null). */
export function parsePiiKey(raw: string | null | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    const buf = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (buf.length === 32) return buf;
  }
  return null;
}

export function getPiiKeyFromEnv(): Buffer | null {
  return parsePiiKey(process.env.ADVISOR_PII_KEY);
}

export function piiEnabled(): boolean {
  return getPiiKeyFromEnv() !== null;
}

export function piiAad(profileId: string, field: PiiField): Buffer {
  return Buffer.from(`${profileId}:${field}`, "utf8");
}

export function encryptPii(plain: string, key: Buffer, aad: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_PREFIX, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Çözülemezse (yanlış anahtar, bozuk veri, AAD uyuşmazlığı) null; asla fırlatmaz. */
export function decryptPii(payload: string | null | undefined, key: Buffer, aad: Buffer): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
