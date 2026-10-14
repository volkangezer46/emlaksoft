import "server-only";
import { createHash } from "node:crypto";
import { openPlatformSecret, platformSecretsEnabled, sealPlatformSecret } from "@/lib/platform-secrets";

/**
 * Gizli ayarların (API anahtarı vb.) şifreli saklama yardımcıları. SUNUCUYA ÖZEL.
 * Saklama biçimi `v1.<iv>.<tag>.<şifreli>` (platform-secrets.ts; AAD = `platform_settings:<depo anahtarı>`).
 *
 * GEÇİŞ DÖNEMİ: `v1.` öneki yoksa değer eski DÜZ METİN sayılır ve olduğu gibi kabul edilir; böylece şifreleme
 * açılmadan önce yazılmış anahtarlar çalışmaya devam eder. Düz metni şifrelemek tek seferlik, süper admin onaylı
 * `encryptPlaintextSecrets` eylemidir (otomatik DEĞİL).
 */

export const SEALED_PREFIX = "v1.";

export function isSealed(raw: string | null | undefined): boolean {
  return typeof raw === "string" && raw.startsWith(SEALED_PREFIX);
}

export class PlaintextSecretError extends Error {
  constructor() {
    super("Gizli ayar düz metin olarak saklanmış; mühürlü olmayan değer kabul edilmez.");
    this.name = "PlaintextSecretError";
  }
}

/**
 * Sıkı okuma kapısı (geçiş dönemi istisnası OLMAYAN anahtar aileleri için, ör. `google.*`): boş/yok = null,
 * mühürlü değer olduğu gibi döner, düz metin FIRLATIR. Mevcut `revealSecret` davranışı değişmez.
 */
export function requireSealed(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (!isSealed(raw)) throw new PlaintextSecretError();
  return raw;
}

/** Şifreleme anahtarı var mı? (Yoksa gizli ayar YAZILMAZ; düz metin asla yazılmaz.) */
export function secretsWritable(): boolean {
  return platformSecretsEnabled();
}

/** Şifreler; anahtar yoksa null. */
export function sealSecret(storageKey: string, plain: string): string | null {
  return sealPlatformSecret(storageKey, plain);
}

/**
 * Depodaki ham değerden düz metni çıkarır. Şifreli ise çözer (çözülemezse null), şifresiz ise (geçiş dönemi) olduğu gibi döner.
 * Boş/yok = null. Asla fırlatmaz.
 */
export function revealSecret(storageKey: string, raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (isSealed(raw)) return openPlatformSecret(storageKey, raw);
  return raw;
}

/** Değersiz parmak izi (sürüm karşılaştırma/denetim için): sha256 ön eki. Düz değer geri çıkarılamaz. */
export function secretFingerprint(storageKey: string, plain: string): string {
  return `sha256:${createHash("sha256").update(`${storageKey}\0${plain}`).digest("hex").slice(0, 12)}`;
}