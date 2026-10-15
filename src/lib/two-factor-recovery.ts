import { createHmac, randomBytes } from "node:crypto";

/**
 * Authenticator 2FA kurtarma kodları (araştırma 4). `node:crypto` istemci paketine girmez (yalnız sunucu).
 *
 * - 10 kod, her biri 10 karakter (karışmayan 32 harfli alfabe: 0/O/1/I yok) → kod başına 50 bit; "ABCDE-FGHJK" biçimi.
 * - Saklama: HMAC-SHA256(OTP_HMAC_SECRET, ["recovery-v1", userId, kod]) hex. Kod deterministik özetlendiği için
 *   DB'de eşitlikle aranır; gizli anahtar olmadan sızan özet tablosundan kod üretilemez.
 * - Kod tek kullanımlıktır (used_at); yeni set üretmek eskileri siler.
 */

export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const MIN_SECRET_BYTES = 32;

export class RecoveryCodeConfigurationError extends Error {
  constructor() {
    super("OTP_HMAC_SECRET must contain at least 32 bytes.");
    this.name = "RecoveryCodeConfigurationError";
  }
}

/** Biçimli kod: "ABCDE-FGHJK". */
export function formatRecoveryCode(raw: string): string {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
  random: (size: number) => Uint8Array = (size) => randomBytes(size),
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = random(CODE_LENGTH);
    let raw = "";
    for (let i = 0; i < CODE_LENGTH; i++) raw += ALPHABET[bytes[i]! % ALPHABET.length];
    codes.add(formatRecoveryCode(raw));
  }
  return [...codes];
}

/** Kullanıcı girdisi: boşluk/tire atılır, büyük harfe çevrilir; 10 geçerli karakter değilse null. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, "");
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

export function hashRecoveryCode(
  code: string,
  userId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.OTP_HMAC_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) throw new RecoveryCodeConfigurationError();
  const normalized = normalizeRecoveryCode(code);
  if (!normalized || !userId.trim()) throw new TypeError("A valid recovery code and user id are required.");
  return createHmac("sha256", secret).update(JSON.stringify(["recovery-v1", userId, normalized]), "utf8").digest("hex");
}
