import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-only OTP digest boundary.
 *
 * Importing `node:crypto` deliberately prevents this module from being bundled
 * into a Client Component. OTP peppers must never use a NEXT_PUBLIC_* variable
 * or be shared with another signing key.
 */
const OTP_HASH_VERSION = "hmac-sha256-v1";
const OTP_HASH_PREFIX = `${OTP_HASH_VERSION}:`;
const OTP_CODE_PATTERN = /^\d{6}$/;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MIN_SECRET_BYTES = 32;

export type OtpPurpose = "login" | "contract-signature";
export type OtpHashEnvironment = Readonly<Record<string, string | undefined>>;

export class OtpHashConfigurationError extends Error {
  constructor() {
    super("OTP_HMAC_SECRET must contain at least 32 bytes.");
    this.name = "OtpHashConfigurationError";
  }
}

function otpSecret(env: OtpHashEnvironment): string {
  const secret = env.OTP_HMAC_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new OtpHashConfigurationError();
  }
  return secret;
}

function inputFor(code: string, purpose: OtpPurpose, subjectId: string): string {
  // JSON provides an unambiguous domain separator between purpose, subject
  // and code; the same six-digit value therefore has a different digest in
  // every challenge context.
  return JSON.stringify([OTP_HASH_VERSION, purpose, subjectId, code]);
}

function equalSha256Hex(left: string, right: string): boolean {
  if (!HEX_SHA256_PATTERN.test(left) || !HEX_SHA256_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function validateNewHashInput(code: string, subjectId: string): void {
  if (!OTP_CODE_PATTERN.test(code) || !subjectId.trim()) {
    throw new TypeError("A six-digit OTP and non-empty subject are required.");
  }
}

/** Returns a versioned, peppered digest suitable for a text database column. */
export function hashOtpForStorage(
  code: string,
  purpose: OtpPurpose,
  subjectId: string,
  env: OtpHashEnvironment = process.env,
): string {
  validateNewHashInput(code, subjectId);
  const digest = createHmac("sha256", otpSecret(env))
    .update(inputFor(code, purpose, subjectId), "utf8")
    .digest("hex");
  return `${OTP_HASH_PREFIX}${digest}`;
}

/**
 * Constant-time verification for current HMAC records.
 *
 * Unprefixed 64-character SHA-256 values are accepted only as a rollout
 * bridge for already-issued five-minute challenges. Successful OTPs are
 * deleted/nullified by their callers, and every newly issued OTP uses HMAC.
 */
export function verifyOtpHash(
  code: string,
  storedHash: string | null | undefined,
  purpose: OtpPurpose,
  subjectId: string,
  env: OtpHashEnvironment = process.env,
): boolean {
  if (!OTP_CODE_PATTERN.test(code) || !subjectId.trim() || !storedHash) return false;

  if (storedHash.startsWith(OTP_HASH_PREFIX)) {
    const actual = storedHash.slice(OTP_HASH_PREFIX.length);
    const expected = createHmac("sha256", otpSecret(env))
      .update(inputFor(code, purpose, subjectId), "utf8")
      .digest("hex");
    return equalSha256Hex(actual, expected);
  }

  // Legacy values have no version prefix. Unknown versioned formats fail
  // closed and can never fall through to the legacy comparison.
  if (!HEX_SHA256_PATTERN.test(storedHash)) return false;
  const legacyExpected = createHash("sha256").update(code, "utf8").digest("hex");
  return equalSha256Hex(storedHash, legacyExpected);
}

