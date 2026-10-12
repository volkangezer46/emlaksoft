import { createHash, createHmac, hkdfSync } from "node:crypto";
import { PLATFORM_SECRETS_DERIVE_SOURCES } from "@/lib/platform-secrets";

/**
 * Telefon özeti (yalnız SUNUCU). Aranmasın listesi ve tekrar ilan eşleşmesi ham numarayı saklamadan çalışsın diye özet tutulur.
 * Girdi `parsePhoneStrict().stored` olmalıdır (tek biçim).
 *
 * - v1 (eski): `sha256("fsbo-v1|<kiracı>|<numara>")`. Tuz kiracı UUID'si olduğundan, tabloya erişen biri 10 haneli TR numara
 *   uzayını (milyarlarca) kaba kuvvetle çözebilir. YENİ KAYITLARDA yalnız anahtar yoksa kullanılır.
 * - v2 (yeni): `HMAC-SHA256(sunucu anahtarı, "fsbo-v2|<kiracı>|<numara>")`. Anahtar veritabanında DEĞİL, sunucu ortamındadır.
 *   Anahtar sırası: `FSBO_PHONE_HMAC_KEY` (>= 32 karakter; ÖNERİLEN) → canlıda zaten zorunlu sunucu sırrından HKDF ile türetilmiş
 *   alan-ayrımlı anahtar (platform-secrets deseni) → yok: v1'e düşülür.
 * GEÇİŞ DÖNEMİ: kayıtlı özetler iki biçimde bulunabilir; aramalar `phoneHashCandidates` ile her ikisine bakar, yeni kayıtlar v2 yazar.
 * UYARI: anahtar DÖNDÜRÜLÜRSE v2 özetleri eşleşmez (aranmasın kaçar); döndürmeden önce docs/DEPLOY.md notuna bakın.
 */
const MIN_KEY_LENGTH = 32;
const HKDF_SALT = "emlaksoft:fsbo-phone-hmac:salt:v2";
const HKDF_INFO = "emlaksoft/fsbo-phone-hmac/v2";

function hmacKey(): Buffer | null {
  const direct = process.env.FSBO_PHONE_HMAC_KEY?.trim();
  if (direct && direct.length >= MIN_KEY_LENGTH) return Buffer.from(direct, "utf8");
  for (const name of PLATFORM_SECRETS_DERIVE_SOURCES) {
    const secret = process.env[name]?.trim();
    if (!secret || secret.length < 24) continue;
    return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
  }
  return null;
}

export function phoneHashV1(tenantId: string, storedPhone: string): string {
  return createHash("sha256").update(`fsbo-v1|${tenantId}|${storedPhone.trim()}`, "utf8").digest("hex");
}

/** Sunucu anahtarı yoksa null (çağıran v1'e düşer). */
export function phoneHashV2(tenantId: string, storedPhone: string): string | null {
  const key = hmacKey();
  if (!key) return null;
  return createHmac("sha256", key).update(`fsbo-v2|${tenantId}|${storedPhone.trim()}`, "utf8").digest("hex");
}

/** YENİ kayıtlarda yazılacak özet: v2, anahtar yoksa v1. */
export function phoneHash(tenantId: string, storedPhone: string): string {
  return phoneHashV2(tenantId, storedPhone) ?? phoneHashV1(tenantId, storedPhone);
}

/** Arama için tüm geçerli özetler (v2 önce, sonra v1). */
export function phoneHashCandidates(tenantId: string, storedPhone: string | null | undefined): string[] {
  if (!storedPhone) return [];
  const v2 = phoneHashV2(tenantId, storedPhone);
  const v1 = phoneHashV1(tenantId, storedPhone);
  return v2 ? [v2, v1] : [v1];
}

/** Bir kaydın aranmasın sorgusunda kullanılacak özetleri: telefon varsa v2+v1, her zaman kayıtlı özet. Tekilleştirilmiş. */
export function leadHashCandidates(tenantId: string, storedPhone: string | null | undefined, storedHash: string | null | undefined): string[] {
  const out = new Set<string>(phoneHashCandidates(tenantId, storedPhone));
  if (storedHash) out.add(storedHash);
  return [...out];
}
