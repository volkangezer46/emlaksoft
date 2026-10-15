import type { User } from "@supabase/supabase-js";

/**
 * Oturum doğrulama: proxy ile sunucu bileşenleri arasında TEK doğrulama (SK1/B019, HAFIZA §30).
 *
 * GERÇEK DURUM (2026-10-15 ölçüldü): GoTrue erişim JWT'sini HS256 ile imzalıyor ve `/auth/v1/.well-known/jwks.json`
 * `{"keys":[]}` dönüyor. auth-js `getClaims()` HS* algoritmada `getUser()`'a düşer: her çağrı Auth sunucusuna AĞ TURU
 * (Kong'da /auth/v1/user; p50 57-72 ms, patlamada ~1 sn). Eski akışta /app başına 2, /admin başına 3 tur vardı.
 *
 * YENİ AKIŞ (bu dosya; WebCrypto, Node ve proxy çalışma zamanında aynı):
 *   1. Proxy oturumu çerezden okur (`getSession`; süresi ≤90 sn kalmışsa GoTrue yenilemesi + çerez), erişim JWT'sini
 *      `verifyAccessToken` ile doğrular:
 *        - HS256 + `SUPABASE_JWT_SECRET` (yalnız sunucu ortamı): imza, `exp`, `aud=authenticated`, `role=authenticated`,
 *          `sub`, `iss` YEREL denetlenir — ağ turu YOK.
 *        - Asimetrik (ES256/RS256): auth-js `getClaims(token)` (JWKS yerel, kütüphane önbellekli).
 *        - Sır tanımsız / `iss` beklenmedik: YEDEK YOL — `getUser(token)` sonucu erişim belirtecinin SHA-256 özetiyle
 *          süreç içinde min(exp, 60 sn) önbelleğe alınır (iptal edilen oturum en geç 60 sn içinde reddedilir).
 *   2. Proxy kapı RPC'si (`proxy_gate_snapshot`) aynı turda `session_alive` döner (auth.sessions; çıkış yapılmış /
 *      iptal edilmiş oturum bir sonraki istekte reddedilir) ve aktif profil / askı / 2FA kapıları çalışır.
 *   3. Kapılar geçince doğrulanmış kimlik (JWT claim'lerinin tamamı: sub, rol, tenant claim'leri, session_id, aal, amr…)
 *      İMZALI iç başlıkla (`AUTH_VERIFIED_HEADER`) sunucuya taşınır. `getRequestUser` / `getRequestClaims` (auth-cache)
 *      ve `isPlatformSessionExpired` aynı istekte YENİDEN doğrulamaz; başlığı okur.
 *
 * BAŞLIK GÜVENLİĞİ: değer `v1.<base64url(claims)>.<HMAC-SHA256>`; anahtar yalnız sunucuda bulunan bir sırdan alan-ayrımlı
 * türetilir. Proxy her istekte gelen başlığı ÖNCE siler; /api yolları proxy dışında olduğundan oraya istemcinin
 * gönderdiği başlık ulaşabilir — imza olmadan kabul edilmez. Anahtar yoksa `v0.<userId>` yazılır (yalnız proxy içi
 * boşta kalma politikası okur); sunucu bunu kimlik saymaz, yedek yola düşer.
 */
export const AUTH_VERIFIED_HEADER = "x-emlaksoft-auth-verified";

export type AuthClaims = Record<string, unknown> & { sub?: unknown; exp?: unknown; session_id?: unknown };

/** Doğrulanmış claims → tüketicilerin kullandığı alanlarla User (id, app_metadata, user_metadata, email, phone). */
export function userFromClaims(claims: AuthClaims): User | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    role: typeof claims.role === "string" ? claims.role : "authenticated",
    email: typeof claims.email === "string" ? claims.email : undefined,
    phone: typeof claims.phone === "string" ? claims.phone : undefined,
    app_metadata: (claims.app_metadata ?? {}) as User["app_metadata"],
    user_metadata: (claims.user_metadata ?? {}) as User["user_metadata"],
    is_anonymous: claims.is_anonymous === true,
    created_at: "",
  } as User;
}

// ---------------------------------------------------------------------------------------------------------------------
// base64url / UTF-8 yardımcıları (Buffer yok: proxy çalışma zamanında da çalışır)
// ---------------------------------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlToBytes(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseJsonObject(bytes: Uint8Array | null): Record<string, unknown> | null {
  if (!bytes) return null;
  try {
    const v = JSON.parse(decoder.decode(bytes)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type JwtParts = { header: Record<string, unknown>; payload: AuthClaims; signingInput: string; signature: Uint8Array };

/** JWT'yi parçalar (imza DOĞRULANMAZ). Biçim bozuksa null. */
export function decodeJwtParts(token: string): JwtParts | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = parseJsonObject(b64urlToBytes(parts[0]!));
  const payload = parseJsonObject(b64urlToBytes(parts[1]!));
  const signature = b64urlToBytes(parts[2]!);
  if (!header || !payload || !signature) return null;
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

// ---------------------------------------------------------------------------------------------------------------------
// HS256 yerel doğrulama
// ---------------------------------------------------------------------------------------------------------------------

export type LocalVerifyFailure = "malformed" | "alg" | "signature" | "expired" | "audience" | "role" | "subject" | "issuer";
export type LocalVerifyResult = { ok: true; claims: AuthClaims } | { ok: false; reason: LocalVerifyFailure };

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    hmacKeys.set(secret, key);
  }
  return key;
}

/**
 * Beklenen `iss` değerleri. `SUPABASE_JWT_ISSUER` (virgülle birden çok) tanımlıysa YALNIZ onlar; değilse Supabase kökü ve
 * `<kök>/auth/v1` kabul edilir, `iss` taşımayan belirteç de geçer (self-hosted GoTrue `GOTRUE_JWT_ISSUER` yokken `iss`
 * yazmaz). Beklenmeyen `iss` belirteci REDDETMEZ: yedek ağ doğrulamasına düşülür (yanlış yapılandırma kesinti yaratmaz).
 */
export function expectedJwtIssuers(env: Record<string, string | undefined> = process.env): { list: string[]; allowMissing: boolean } {
  const explicit = (env.SUPABASE_JWT_ISSUER ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (explicit.length > 0) return { list: explicit, allowMissing: false };
  const base = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  return { list: base ? [base, `${base}/auth/v1`] : [], allowMissing: true };
}

/** HS256 erişim belirtecini yerel doğrular: imza (sabit zamanlı WebCrypto), exp, aud, role, sub, iss. */
export async function verifyHs256Jwt(
  token: string,
  secret: string,
  opts: { nowMs: number; issuers?: { list: string[]; allowMissing: boolean } },
): Promise<LocalVerifyResult> {
  const parts = decodeJwtParts(token);
  if (!parts) return { ok: false, reason: "malformed" };
  if (parts.header.alg !== "HS256") return { ok: false, reason: "alg" };
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    parts.signature as Uint8Array<ArrayBuffer>,
    encoder.encode(parts.signingInput),
  );
  if (!valid) return { ok: false, reason: "signature" };
  const c = parts.payload;
  if (typeof c.exp !== "number" || c.exp * 1000 <= opts.nowMs) return { ok: false, reason: "expired" };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes("authenticated")) return { ok: false, reason: "audience" };
  if (c.role !== "authenticated") return { ok: false, reason: "role" };
  if (typeof c.sub !== "string" || !c.sub) return { ok: false, reason: "subject" };
  const issuers = opts.issuers ?? expectedJwtIssuers();
  if (c.iss === undefined ? !issuers.allowMissing : !issuers.list.includes(String(c.iss))) {
    return { ok: false, reason: "issuer" };
  }
  return { ok: true, claims: c };
}

// ---------------------------------------------------------------------------------------------------------------------
// Belirteç doğrulama (yerel → JWKS → önbellekli ağ yedeği)
// ---------------------------------------------------------------------------------------------------------------------

/** auth-js istemcisinin kullanılan yüzeyi (testte sahtelenir). */
export type AuthVerifier = {
  getUser(jwt?: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  getClaims(jwt?: string): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
};

export type VerifiedVia = "local" | "jwks" | "cache" | "network";
export type VerifiedToken = { claims: AuthClaims; via: VerifiedVia };

/** Yedek yolun önbellek tavanı: iptal edilen oturum en geç bu kadar sonra reddedilir. */
export const FALLBACK_CACHE_MAX_MS = 60_000;
const FALLBACK_CACHE_MAX_ENTRIES = 5_000;
const fallbackCache = new Map<string, { claims: AuthClaims; until: number }>();
let issuerWarned = false;

/** Test yardımcısı: yedek yol önbelleğini boşaltır. */
export function resetVerifiedTokenCache(): void {
  fallbackCache.clear();
  issuerWarned = false;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
  let out = "";
  for (const b of digest) out += b.toString(16).padStart(2, "0");
  return out;
}

function pruneFallbackCache(nowMs: number) {
  if (fallbackCache.size < FALLBACK_CACHE_MAX_ENTRIES) return;
  for (const [k, v] of fallbackCache) if (v.until <= nowMs) fallbackCache.delete(k);
  // Hâlâ doluysa en eski kayıtlar (ekleme sırası) düşer.
  for (const k of fallbackCache.keys()) {
    if (fallbackCache.size < FALLBACK_CACHE_MAX_ENTRIES * 0.9) break;
    fallbackCache.delete(k);
  }
}

/** Ortamdaki HS256 sırrı (yalnız sunucu; NEXT_PUBLIC değil). */
export function supabaseJwtSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.SUPABASE_JWT_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

/**
 * Erişim belirtecini doğrular; geçersizse null. `mode: "network"` yerel doğrulamayı atlar (proxy dışı /api yolları:
 * oturum iptali en geç 60 sn içinde görülsün). Yerel imza/süre hatası ağ yoluna DÜŞMEZ (reddedilir).
 */
export async function verifyAccessToken(
  auth: AuthVerifier,
  token: string,
  opts: { nowMs: number; secret?: string | null; mode?: "local" | "network" },
): Promise<VerifiedToken | null> {
  const parts = decodeJwtParts(token);
  if (!parts) return null;
  const alg = typeof parts.header.alg === "string" ? parts.header.alg : "";
  const secret = opts.secret === undefined ? supabaseJwtSecret() : opts.secret;
  if (opts.mode !== "network") {
    if (alg === "HS256" && secret) {
      const r = await verifyHs256Jwt(token, secret, { nowMs: opts.nowMs });
      if (r.ok) return { claims: r.claims, via: "local" };
      if (r.reason !== "issuer") return null;
      if (!issuerWarned) {
        issuerWarned = true;
        console.warn("[auth] JWT iss beklenmiyor; SUPABASE_JWT_ISSUER ayarlanana dek ağ doğrulaması kullanılıyor");
      }
    } else if (alg && !alg.startsWith("HS")) {
      const { data, error } = await auth.getClaims(token);
      if (error || !data?.claims) return null;
      return { claims: data.claims as AuthClaims, via: "jwks" };
    }
  }
  const exp = typeof parts.payload.exp === "number" ? parts.payload.exp * 1000 : 0;
  if (exp <= opts.nowMs) return null;
  const key = await sha256Hex(token);
  const hit = fallbackCache.get(key);
  if (hit && hit.until > opts.nowMs) return { claims: hit.claims, via: "cache" };
  if (hit) fallbackCache.delete(key);
  const { data, error } = await auth.getUser(token);
  if (error || !data?.user || data.user.id !== parts.payload.sub) return null;
  pruneFallbackCache(opts.nowMs);
  fallbackCache.set(key, { claims: parts.payload, until: Math.min(exp, opts.nowMs + FALLBACK_CACHE_MAX_MS) });
  return { claims: parts.payload, via: "network" };
}

// ---------------------------------------------------------------------------------------------------------------------
// İmzalı iç başlık
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Başlık anahtarının kaynakları (öncelik sırası): yalnız sunucuda bulunan sırlar. service_role anahtarı BİLEREK yok
 * (yalnız createAdminClient okur; admin-client-tenant-contract). TWO_FACTOR_COOKIE_SECRET üretimde zorunludur
 * (deployment-env), bu yüzden SUPABASE_JWT_SECRET tanımsızken de başlık imzalıdır.
 */
export const VERIFIED_HEADER_KEY_SOURCES = ["SUPABASE_JWT_SECRET", "TWO_FACTOR_COOKIE_SECRET"] as const;
const HEADER_KEY_INFO = "emlaksoft:verified-request:v1";
const derivedHeaderKeys = new Map<string, Promise<CryptoKey>>();

function headerKeySource(env: Record<string, string | undefined>): string | null {
  for (const name of VERIFIED_HEADER_KEY_SOURCES) {
    const v = env[name]?.trim();
    if (v && v.length >= 16) return v;
  }
  return null;
}

/** Kaynak sırdan alan-ayrımlı türetilmiş HMAC anahtarı (kaynağın kendisi başlık imzasında kullanılmaz). */
function headerKey(env: Record<string, string | undefined>): Promise<CryptoKey> | null {
  const source = headerKeySource(env);
  if (!source) return null;
  let key = derivedHeaderKeys.get(source);
  if (!key) {
    key = (async () => {
      const raw = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(source), encoder.encode(HEADER_KEY_INFO)));
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    })();
    derivedHeaderKeys.set(source, key);
  }
  return key;
}

/**
 * Proxy'nin aynı istekte kapı RPC'sinden öğrendiği olgular (claim değil). `staff`: aktif platform personeli satırı
 * görünüyor mu. Sunucu bunu YALNIZ "personel değil" kısayolu için kullanır (platform_staff okuması atlanır); personel
 * yetkisi her zaman kendi sorgusuyla kurulur — olgu yetki GENİŞLETMEZ.
 */
export type VerifiedFacts = { staff?: boolean };
export type VerifiedRequest = { claims: AuthClaims; facts: VerifiedFacts };

/** Doğrulanmış claims (+ proxy olguları) → başlık değeri. Anahtar yoksa `v0.<sub>` (sunucu kimlik saymaz). */
export async function signVerifiedIdentity(
  claims: AuthClaims,
  facts: VerifiedFacts = {},
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const key = headerKey(env);
  if (!key) return `v0.${sub}`;
  const payload = bytesToB64url(encoder.encode(JSON.stringify({ c: claims, f: facts })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key, encoder.encode(`v1.${payload}`)));
  return `v1.${payload}.${bytesToB64url(mac)}`;
}

function payloadOf(value: string): { c?: unknown; f?: unknown } | null {
  return parseJsonObject(b64urlToBytes(value.split(".")[1] ?? "")) as { c?: unknown; f?: unknown } | null;
}

/** Başlığı doğrular (imza + exp). Geçersiz, imzasız (`v0`) ya da süresi dolmuşsa null. */
export async function readVerifiedRequest(
  value: string | null | undefined,
  nowMs: number,
  env: Record<string, string | undefined> = process.env,
): Promise<VerifiedRequest | null> {
  if (!value || !value.startsWith("v1.")) return null;
  const [, payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined) return null;
  const key = headerKey(env);
  const macBytes = b64urlToBytes(mac);
  if (!key || !macBytes) return null;
  const ok = await crypto.subtle.verify("HMAC", await key, macBytes as Uint8Array<ArrayBuffer>, encoder.encode(`v1.${payload}`));
  if (!ok) return null;
  const body = payloadOf(value);
  const claims = body?.c && typeof body.c === "object" && !Array.isArray(body.c) ? (body.c as AuthClaims) : null;
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return null;
  const f = body?.f && typeof body.f === "object" ? (body.f as Record<string, unknown>) : {};
  return { claims, facts: typeof f.staff === "boolean" ? { staff: f.staff } : {} };
}

/** `readVerifiedRequest`'in yalnız claim'leri. */
export async function readVerifiedIdentity(
  value: string | null | undefined,
  nowMs: number,
  env: Record<string, string | undefined> = process.env,
): Promise<AuthClaims | null> {
  return (await readVerifiedRequest(value, nowMs, env))?.claims ?? null;
}

/**
 * Başlıktaki kullanıcı kimliği, İMZA DENETLEMEDEN. YALNIZ proxy içinde, başlığı aynı istekte kendisi yazdıktan sonra
 * kullanır (gelen başlık önce silinir); sunucu tarafı `readVerifiedRequest` kullanır.
 */
export function peekVerifiedUserId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("v0.")) return value.slice(3) || null;
  if (!value.startsWith("v1.")) return null;
  const c = payloadOf(value)?.c as AuthClaims | undefined;
  return typeof c?.sub === "string" && c.sub ? c.sub : null;
}
