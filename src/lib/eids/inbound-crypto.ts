import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parsePiiKey } from "@/lib/advisor/pii-crypto";
import { normalizePersonName } from "./mail-parse";

/**
 * EİDS e-posta alımının anahtar/özet/şifre yardımcıları — yalnız sunucu (node:crypto).
 *
 * Ortam değişkenleri (ikisi de isteğe bağlı; yokken ilgili yol KAPALI kalır, açık yazılmaz):
 *  - EIDS_INBOUND_SECRET: SMTP köprüsünün (infra/eids-inbound) /api/inbound/eids isteklerini imzaladığı HMAC anahtarı
 *    (en az 32 karakter). Yoksa uç nokta 503 döner. Köprü ile uygulama AYNI değeri taşır.
 *  - EIDS_MAIL_KEY: alma adresi anahtarını ve ham .eml'i mühürleyen AES-256-GCM anahtarı (64 hex ya da 32 bayt base64).
 *    Yoksa adres üretilemez (kart "sunucu anahtarı bekleniyor" der) ve ham e-posta SAKLANMAZ; ayrıştırma çalışır.
 *    Köprüde BULUNMAZ (köprü yalnız HMAC anahtarını bilir).
 */

export const EIDS_ADDRESS_DOMAIN = "eids.emlaksoft.com.tr";
export const EIDS_TOKEN_LENGTH = 16;
/** Karışmayan küçük harf + rakam (0/o, 1/l çıkarıldı); 16 karakter ≈ 81 bit. */
const TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const ADDRESS_RE = /^yetki-([a-z0-9]{16})@eids\.emlaksoft\.com\.tr$/;
/** İmzalı köprü isteğinin geçerlilik penceresi (sn). */
export const BRIDGE_MAX_SKEW_SEC = 300;

export function generateInboundToken(): string {
  const bytes = randomBytes(EIDS_TOKEN_LENGTH * 2);
  let out = "";
  for (const b of bytes) {
    // 256 / 32 = 8: kalansız eşleme (yanlılık yok).
    out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
    if (out.length === EIDS_TOKEN_LENGTH) break;
  }
  return out;
}

export function addressForToken(token: string): string {
  return `yetki-${token}@${EIDS_ADDRESS_DOMAIN}`;
}

/** Alıcı adresinden anahtar (biçim dışıysa null; büyük/küçük harf duyarsız). */
export function tokenFromAddress(address: string | null | undefined): string | null {
  const m = ADDRESS_RE.exec(String(address ?? "").trim().toLowerCase().replace(/^<|>$/g, ""));
  return m ? m[1]! : null;
}

export function hashInboundToken(token: string): string {
  return createHash("sha256").update(`eids-inbound:v1:${token}`, "utf8").digest("hex");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Malik adının eşleştirme özeti: sha256(katlanmış, sıralı ad). EP2 defterindeki `hashGrantorName` ile AYNI formül
 * (önek yok) — gelen e-posta kaydı ile olay defteri aynı özeti taşır.
 */
export function grantorNameHash(name: string): string | null {
  const n = normalizePersonName(name);
  return n ? sha256Hex(n) : null;
}

/** Ham e-postadan e-posta adresini maskeler: "ab***@ornek.com" (reddedilen göndericinin izi). */
export function maskEmailAddress(addr: string | null): string | null {
  if (!addr) return null;
  const [local = "", domain = ""] = addr.split("@");
  return `${local.slice(0, 2)}***@${domain}`.slice(0, 254);
}

// ---------------------------------------------------------------------------------------------------------------
// Mühür (AES-256-GCM): v1.<iv>.<tag>.<şifreli> (base64url). AAD: amaç + ofis kimliği (başka satıra taşınırsa çözülmez).

export function getMailKey(): Buffer | null {
  return parsePiiKey(process.env.EIDS_MAIL_KEY);
}

export function seal(plain: Buffer, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function unseal(payload: string | null | undefined, key: Buffer, aad: string): Buffer | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1]!, "base64url"));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([d.update(Buffer.from(parts[3]!, "base64url")), d.final()]);
  } catch {
    return null;
  }
}

export const tokenAad = (tenantId: string) => `eids-token:${tenantId}`;
export const rawAad = (tenantId: string) => `eids-raw:${tenantId}`;

/** PostgREST bytea yazımı: "\x<hex>". */
export function toByteaHex(s: string): string {
  return `\\x${Buffer.from(s, "utf8").toString("hex")}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Köprü imzası: HMAC-SHA256(secret, `${ts}.${gövde}`) hex; başlıklar x-eids-timestamp / x-eids-signature.

export function getBridgeSecret(): string | null {
  const s = (process.env.EIDS_INBOUND_SECRET ?? "").trim();
  return s.length >= 32 ? s : null;
}

export function signBridgeBody(secret: string, ts: number, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
}

export function verifyBridgeSignature(input: { secret: string; ts: string | null; signature: string | null; body: string; nowSec: number }): boolean {
  const ts = Number(input.ts);
  if (!Number.isInteger(ts) || Math.abs(input.nowSec - ts) > BRIDGE_MAX_SKEW_SEC) return false;
  const sig = String(input.signature ?? "");
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const expected = Buffer.from(signBridgeBody(input.secret, ts, input.body), "hex");
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}
