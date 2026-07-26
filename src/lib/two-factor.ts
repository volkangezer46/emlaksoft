/**
 * SMS tabanlı iki adımlı doğrulama (2FA) yardımcıları.
 *
 * Akış kararı (pragmatik): şifre doğrulanınca Supabase oturumu AÇIK kalır,
 * ama `es_2fa_ok` httpOnly çerezi olmadan middleware /app - /admin isteklerini
 * /giris/dogrulama'ya yönlendirir. Kod doğrulanınca çerez set edilir.
 * Çerez değeri HMAC-SHA256(user_id, servis anahtarı) olduğundan istemci
 * tarafından üretilemez; silinirse kullanıcı yalnızca doğrulama sayfasına
 * düşer (bypass yok).
 *
 * Bu dosya middleware'den de import edildiği için bilinçli olarak bağımlılıksız
 * ve Web Crypto tabanlıdır (Node + Edge her iki runtime'da çalışır).
 */

export const TWO_FACTOR_COOKIE = "es_2fa_ok";
export const LOGIN_CODE_TTL_MS = 5 * 60_000; // 5 dk
export const LOGIN_CODE_MAX_ATTEMPTS = 5;

/** Çerez imza anahtarı — yalnız sunucuda bulunur, istemciye asla gitmez. */
function cookieSecret(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ""
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 6 haneli giriş kodu (kriptografik rastgele). */
export function generateLoginCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** Kod hash'i — düz metin saklanmaz (imza OTP'siyle aynı desen). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toHex(digest);
}

/** Kullanıcıya özel, taklit edilemez çerez değeri. */
export async function twoFactorCookieValue(userId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cookieSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`2fa-ok:${userId}`),
  );
  return toHex(sig);
}

/** Çerez bu kullanıcı için geçerli mi? (sabit-zamanlı karşılaştırma) */
export async function isTwoFactorCookieValid(
  value: string | undefined | null,
  userId: string,
): Promise<boolean> {
  if (!value) return false;
  const expected = await twoFactorCookieValue(userId);
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** httpOnly — JS erişemez; her şifreli girişte yeniden set/temizlenir. */
export function twoFactorCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 gün — sonraki şifreli giriş zaten yeniler
  };
}
