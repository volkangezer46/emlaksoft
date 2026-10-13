import { NEVER_INDEX_PREFIXES } from "@/lib/seo/registry";
import { ISSUE_LIMITS, type IssueArea } from "./types";

/**
 * Bulgu parmak izi ve KAPSAM (SAF). Parmak izi = `area|code|url_norm`.
 *
 * GEÇİCİ KÖPRÜ: S0 (`src/lib/seo/scope.ts`: normalizeUrlForFingerprint, canAutoOptimize) bu paket yazılırken main'de
 * YOKTU. Aynı adlı işlevler burada S0 sözleşmesiyle uyumlu yazıldı; S0 birleşince bu dosyadaki iki işlev oradan
 * yeniden dışa verilir (davranış sözleşme testleriyle kilitli: sorgu/parça/sondaki "/" atılır; oturum yolları kapsam dışı).
 */

/** Yalnız yol: mutlak adres de verilse origin, sorgu ve parça atılır; sondaki "/" (kök hariç) ve yinelenen "/" silinir. */
export function normalizeUrlForFingerprint(raw: string): string {
  let path = String(raw ?? "").trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = "/";
    }
  }
  path = path.replace(/[?#].*$/, "");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return (path || "/").slice(0, ISSUE_LIMITS.url);
}

export function fingerprintOf(area: IssueArea, code: string, url: string): string {
  return `${area}|${code}|${normalizeUrlForFingerprint(url)}`;
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Kokpit kapsamı YALNIZ herkese açık yüzeylerdir: /app, /admin, /api, /giris, /kayit/tamamla, /sifre-yenile, /auth,
 * token'lı portallar ve diğer hiç indekslenmeyen yollar (seo/registry NEVER_INDEX_PREFIXES) kapsam DIŞIDIR.
 */
export function isInPublicScope(url: string): boolean {
  const path = normalizeUrlForFingerprint(url);
  return !NEVER_INDEX_PREFIXES.some((p) => under(path, p));
}

/** Üyelik/oturum akışının herkese açık sayfaları: bulgu gösterilir ama otomatik düzeltme ve AI önerisi ALMAZ. */
const MANUAL_ONLY_PREFIXES = ["/kayit"] as const;

/** Bu yolda otomatik düzeltme (Taslağa al, Otopilot) yapılabilir mi? Kapsam dışı ve üyelik yolları hayır. */
export function canAutoOptimize(url: string): boolean {
  if (!isInPublicScope(url)) return false;
  const path = normalizeUrlForFingerprint(url);
  return !MANUAL_ONLY_PREFIXES.some((p) => under(path, p));
}
