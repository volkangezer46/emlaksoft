import { canAutoOptimize, isPublicScope, normalizeUrlForFingerprint } from "@/lib/seo/scope";
import type { IssueArea } from "./types";

/**
 * Bulgu parmak izi ve KAPSAM (SAF). Parmak izi = `area|code|url_norm`.
 *
 * S0 dikişi tamam: yol normalleştirme ve kapsam kararları TEK kaynaktan (`src/lib/seo/scope.ts`) gelir; bu dosya
 * yalnız Kokpit'in alıştığı adlarla yeniden dışa verir (sorgu/parça/sondaki "/" atılır; oturum yolları kapsam dışı;
 * /kayit gibi üyelik yolları ve ofis içerikli vitrin/danışman sayfaları otomatik düzeltme ALMAZ).
 */

export { canAutoOptimize, normalizeUrlForFingerprint };

export function fingerprintOf(area: IssueArea, code: string, url: string): string {
  return `${area}|${code}|${normalizeUrlForFingerprint(url)}`;
}

/**
 * Kokpit kapsamı YALNIZ herkese açık yüzeylerdir: /app, /admin, /api, /giris, /kayit/tamamla, /sifre-yenile, /auth,
 * token'lı portallar ve diğer hiç indekslenmeyen yollar (seo/registry NEVER_INDEX_PREFIXES) kapsam DIŞIDIR.
 */
export function isInPublicScope(url: string): boolean {
  return isPublicScope(url);
}
