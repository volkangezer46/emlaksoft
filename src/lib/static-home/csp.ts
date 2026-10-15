import { createHash } from "node:crypto";

/**
 * STATİK SAYFA CSP'si (yalnız dönüştürülmüş statik HTML; Next'in normal HTML yedeğine UYGULANMAZ — orada çalışma zamanı
 * betikleri hash'lenmez). Küresel politika (next.config.ts) `script-src 'unsafe-inline'` taşır; statik sayfanın her
 * satır içi betiği bilindiği için burada katı politika verilir (Lighthouse "CSP'nin XSS'e karşı etkinliği" + "Trusted Types"):
 *  - script-src: her satır içi betiğin sha256 özeti + 'strict-dynamic' (hash'li betiğin eklediği modül/betik çalışır).
 *    'unsafe-inline' ve 'self' https: yalnız eski tarayıcı yedeğidir; hash ve 'strict-dynamic' bilen tarayıcı onları yok sayar.
 *  - require-trusted-types-for 'script': HTML/URL yazıcıları (innerHTML, script.src) yalnız politika ile (runtime DOM API
 *    kullanır; ölçüm yükleyicisi "mk-statik" politikası ile).
 *  - object-src 'none', base-uri 'none'. Rota yanıtı next.config başlığının ÜZERİNE yazar (aynı ad).
 * JSON veri blokları (application/ld+json, application/json) çalıştırılmaz → özetlenmez; speculationrules özetlenir.
 */

const EXECUTABLE_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "speculationrules"]);

/** Statik HTML'deki çalıştırılabilir satır içi betiklerin CSP özetleri (sıra korunur, tekrar yok). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = (/\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? "").trim().toLowerCase();
    if (!EXECUTABLE_TYPES.has(type)) continue;
    const h = `'sha256-${createHash("sha256").update(m[2] ?? "", "utf8").digest("base64")}'`;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

function supabaseOrigin(): string {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return u.origin;
  } catch {
    return "";
  }
}

/** Statik sayfa CSP başlık değeri. */
export function staticPageCsp(html: string, opts: { development?: boolean } = {}): string {
  const sb = supabaseOrigin();
  const sbHttp = sb ? ` ${sb}` : "";
  return [
    "default-src 'self'",
    `script-src ${[...inlineScriptHashes(html), "'strict-dynamic'", "'unsafe-inline'", "'self'", "https:"].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sbHttp}`,
    "font-src 'self' data:",
    `connect-src 'self'${sbHttp}`,
    "media-src 'self' data: blob:",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "require-trusted-types-for 'script'",
    ...(opts.development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Statik yanıtın güvenlik başlıkları (CSP + COOP). Önbellek anahtarı (ETag) başına bir kez hesaplanır. */
const memo = new Map<string, Record<string, string>>();
export function staticSecurityHeaders(etag: string, html: string): Record<string, string> {
  const hit = memo.get(etag);
  if (hit) return hit;
  const headers = {
    "Content-Security-Policy": staticPageCsp(html, { development: process.env.NODE_ENV === "development" }),
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (memo.size > 64) memo.clear();
  memo.set(etag, headers);
  return headers;
}
