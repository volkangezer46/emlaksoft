import "server-only";
/**
 * Statik rota iç jetonu: `/api/statik/**` yalnız proxy yeniden yazmasıyla ulaşılabilir.
 *
 * Proxy (src/lib/supabase/middleware.ts) yeniden yazarken istek başlığına `x-static-rewrite: <jeton>` koyar; rota
 * işleyicisi başlık yoksa ya da uyuşmazsa 404 döner (doğrudan curl → 404). Proxy eşleyicisi `/api/` yollarını kapsamaz;
 * dışarıdan gelen istek bu başlığı ancak sırrı bilerek üretebilir.
 *
 * Jeton = HMAC-SHA256(sunucu sırrı, sabit etiket) → sabit değer (süreçler arası aynı, istemciye hiç dönmez).
 * Sır sırası: STATIC_REWRITE_SECRET → OTP_HMAC_SECRET (canlıda zorunlu) → TWO_FACTOR_COOKIE_SECRET → PROPERTY_MEDIA_SIGNING_SECRET.
 * Hiçbiri yoksa jeton yok: proxy yeniden yazmaz, rota her isteğe 404 döner (normal Next sayfası sunulur).
 * Web Crypto kullanır (proxy ve rota işleyicisi çalışma zamanından bağımsız).
 */
export const STATIC_REWRITE_HEADER = "x-static-rewrite";
const LABEL = "emlaksoft:static-rewrite:v1";

type Env = Readonly<Record<string, string | undefined>>;

export function staticRewriteSecret(env: Env = process.env): string | null {
  for (const k of ["STATIC_REWRITE_SECRET", "OTP_HMAC_SECRET", "TWO_FACTOR_COOKIE_SECRET", "PROPERTY_MEDIA_SIGNING_SECRET"]) {
    const v = env[k]?.trim();
    if (v && v.length >= 16) return v;
  }
  return null;
}

async function hmacHex(secret: string, input: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(input)));
  let out = "";
  for (const b of sig) out += b.toString(16).padStart(2, "0");
  return out;
}

let memo: { secret: string; token: Promise<string> } | null = null;

/** Jeton (sır yoksa null). Sır başına bir kez hesaplanır. */
export async function staticRewriteToken(env: Env = process.env): Promise<string | null> {
  const secret = staticRewriteSecret(env);
  if (!secret) return null;
  if (!memo || memo.secret !== secret) memo = { secret, token: hmacHex(secret, LABEL) };
  return memo.token;
}

/** Sabit süreli metin karşılaştırma (uzunluk farkı da tüm karakterler gezilerek reddedilir). */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

type HeaderLike = { get(name: string): string | null };

async function headerMatchesToken(headers: HeaderLike, name: string, env: Env): Promise<boolean> {
  const given = headers.get(name);
  if (!given) return false;
  const want = await staticRewriteToken(env);
  return want !== null && safeEqual(given, want);
}

/** Rota işleyicisi kapısı: başlık var ve jetonla birebir aynı mı? */
export async function hasValidStaticRewrite(headers: HeaderLike, env: Env = process.env): Promise<boolean> {
  return headerMatchesToken(headers, STATIC_REWRITE_HEADER, env);
}

/**
 * Tanı başlığı isteği: `X-Static` (statik / yedek) yalnız bu başlık aynı jetonla gelirse yanıta konur (Hız ekranı öz testi).
 * Herkese açık yanıtta iç sunum ayrıntısı (x-static, x-static-home) görünmez.
 */
export const STATIC_PROBE_HEADER = "x-static-probe";

export async function hasValidStaticProbe(headers: HeaderLike, env: Env = process.env): Promise<boolean> {
  return headerMatchesToken(headers, STATIC_PROBE_HEADER, env);
}
