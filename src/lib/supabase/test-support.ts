/**
 * Oturum testleri için HS256 erişim belirteci ve sahte auth yüzeyi (SK1/B019). YALNIZ testlerde kullanılır; üretim kodu
 * import etmez. Belirteç gerçek HMAC-SHA256 ile imzalanır: proxy'nin YEREL doğrulama yolu (verified-request.ts) testte
 * de aynen çalışır; testler `SUPABASE_JWT_SECRET`'i `TEST_JWT_SECRET` ile ayarlar.
 */

import { now } from "@/lib/clock";

export const TEST_JWT_SECRET = "emlaksoft-test-jwt-secret-0123456789abcdef";

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HS256 imzalı erişim belirteci (aud/role=authenticated, exp=+1 sa varsayılan; claims üzerine yazar). */
export async function signTestAccessToken(
  claims: Record<string, unknown>,
  opts: { secret?: string; nowSec?: number; header?: Record<string, unknown> } = {},
): Promise<string> {
  const nowSec = opts.nowSec ?? Math.floor(now() / 1000);
  const header = opts.header ?? { alg: "HS256", typ: "JWT" };
  const payload = { aud: "authenticated", role: "authenticated", iat: nowSec, exp: nowSec + 3600, ...claims };
  const h = b64url(encoder.encode(JSON.stringify(header)));
  const p = b64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(opts.secret ?? TEST_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

type TestUser = { id: string; app_metadata?: unknown; user_metadata?: unknown; email?: string } | null | undefined;

/**
 * Sahte istemcinin `auth.getSession` gövdesi: geçerli kullanıcıdan (testin sahte `getUser`'ı ya da durum nesnesi) imzalı
 * belirteçli oturum kurar; kullanıcı yoksa oturum yok. `extraClaims` session_id, aal gibi claim'leri ekler.
 */
export async function testSessionFor(user: TestUser, extraClaims: Record<string, unknown> = {}) {
  if (!user) return { data: { session: null }, error: null };
  const access_token = await signTestAccessToken({
    sub: user.id,
    email: user.email,
    app_metadata: user.app_metadata ?? {},
    user_metadata: user.user_metadata ?? {},
    ...extraClaims,
  });
  return { data: { session: { access_token, refresh_token: "r", token_type: "bearer", user } }, error: null };
}
