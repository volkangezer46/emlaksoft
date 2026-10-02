/**
 * SMS tabanli ikinci adim icin kisa omurlu, oturuma bagli kanit cookie'si.
 *
 * Bu modül Edge middleware tarafindan da kullanildigi icin yalnız Web Crypto
 * API'lerini kullanir. Cookie imzasi icin Supabase anahtarlari kesinlikle
 * fallback degildir; ayrik TWO_FACTOR_COOKIE_SECRET zorunludur.
 */

export const TWO_FACTOR_COOKIE = "es_2fa_ok";
export const LOGIN_CODE_TTL_MS = 5 * 60_000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const TWO_FACTOR_COOKIE_TTL_SECONDS = 12 * 60 * 60;

const TOKEN_VERSION = 2;
const MIN_SECRET_LENGTH = 32;
const CLOCK_SKEW_SECONDS = 60;

export type TwoFactorSessionBinding = {
  userId: string;
  sessionId: string;
  profileVersion: number;
  /** Supabase access-token `exp`, seconds since epoch. */
  sessionExpiresAt?: number | null;
};

export function twoFactorBindingFromClaims(
  userId: string,
  profileVersion: number | null | undefined,
  claims: Record<string, unknown> | null | undefined,
): TwoFactorSessionBinding | null {
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : "";
  const subject = typeof claims?.sub === "string" ? claims.sub : "";
  const version = Number(profileVersion);
  if (
    !userId ||
    subject !== userId ||
    !sessionId ||
    !Number.isSafeInteger(version) ||
    version <= 0
  ) {
    return null;
  }
  const rawExpiry = Number(claims?.exp);
  return {
    userId,
    sessionId,
    profileVersion: version,
    sessionExpiresAt: Number.isFinite(rawExpiry) ? rawExpiry : null,
  };
}

type TwoFactorPayload = {
  v: number;
  sub: string;
  sid: string;
  pv: number;
  iat: number;
  exp: number;
};

function cookieSecret(): string | null {
  const value = process.env.TWO_FACTOR_COOKIE_SECRET?.trim() ?? "";
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sign(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)),
  );
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

function isValidBinding(binding: TwoFactorSessionBinding): boolean {
  return (
    binding.userId.length > 0 &&
    binding.sessionId.length > 0 &&
    Number.isSafeInteger(binding.profileVersion) &&
    binding.profileVersion > 0
  );
}

/** 6 haneli giris kodu (kriptografik rastgele). */
export function generateLoginCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/**
 * Kullanici, Supabase oturumu ve profil 2FA surumune bagli imzali kanit.
 * Ayrik imza secret'i eksik/zayifsa fail-closed olarak cookie uretilmez.
 */
export async function twoFactorCookieValue(
  binding: TwoFactorSessionBinding,
  now = Date.now(),
): Promise<string> {
  const secret = cookieSecret();
  if (!secret) {
    throw new Error("TWO_FACTOR_COOKIE_SECRET en az 32 karakter olmalidir.");
  }
  if (!isValidBinding(binding)) {
    throw new Error("Gecerli bir 2FA oturum baglantisi gerekli.");
  }

  const issuedAt = Math.floor(now / 1000);
  const localExpiry = issuedAt + TWO_FACTOR_COOKIE_TTL_SECONDS;
  const sessionExpiry = Number(binding.sessionExpiresAt);
  const expiresAt = Number.isFinite(sessionExpiry) && sessionExpiry > issuedAt
    ? Math.min(localExpiry, sessionExpiry)
    : localExpiry;

  const payload: TwoFactorPayload = {
    v: TOKEN_VERSION,
    sub: binding.userId,
    sid: binding.sessionId,
    pv: binding.profileVersion,
    iat: issuedAt,
    exp: expiresAt,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signed = `v${TOKEN_VERSION}.${encoded}`;
  return `${signed}.${await sign(signed, secret)}`;
}

/** Cookie imzasini, zamanini ve tum oturum baglarini dogrular. */
export async function isTwoFactorCookieValid(
  value: string | undefined | null,
  binding: TwoFactorSessionBinding,
  now = Date.now(),
): Promise<boolean> {
  const secret = cookieSecret();
  if (!value || !secret || !isValidBinding(binding)) return false;

  try {
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== `v${TOKEN_VERSION}`) return false;
    const signed = `${parts[0]}.${parts[1]}`;
    const expected = await sign(signed, secret);
    if (!timingSafeEqual(parts[2]!, expected)) return false;

    const payload = JSON.parse(fromBase64Url(parts[1]!)) as Partial<TwoFactorPayload>;
    const current = Math.floor(now / 1000);
    return (
      payload.v === TOKEN_VERSION &&
      payload.sub === binding.userId &&
      payload.sid === binding.sessionId &&
      payload.pv === binding.profileVersion &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number" &&
      payload.iat <= current + CLOCK_SKEW_SECONDS &&
      payload.exp > current &&
      payload.exp <= payload.iat + TWO_FACTOR_COOKIE_TTL_SECONDS &&
      (!binding.sessionExpiresAt || payload.exp <= binding.sessionExpiresAt)
    );
  } catch {
    return false;
  }
}

/** httpOnly cookie; tokenun kendi `exp` alani da her istekte kontrol edilir. */
export function twoFactorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TWO_FACTOR_COOKIE_TTL_SECONDS,
  };
}
