import { resolveRedirect, type RedirectMap } from "@/lib/seo/redirects";

/**
 * Eşleşmeyen yol (src/app/[...slug]/page.tsx) karar sırası — SAF:
 *  (1) yönlendirme haritası (DEĞİŞMEZ ve önceliklidir), (2) yayındaki özel sayfa, (3) 404.
 * Sayfa yolu birebir eşleşir (büyük harfli ya da sonu '/' olan varyant aynı sayfayı çoğaltmaz).
 */
export type CatchAllDecision =
  | { kind: "redirect"; to: string; status: 307 | 308 }
  | { kind: "page"; id: string; slug: string }
  | { kind: "notfound" };

export function resolveCatchAll(path: string, redirects: RedirectMap, slugMap: Readonly<Record<string, string>>): CatchAllDecision {
  const hit = resolveRedirect(redirects, path);
  if (hit) return { kind: "redirect", ...hit };
  const slug = path.replace(/^\/+/, "");
  const id = Object.prototype.hasOwnProperty.call(slugMap, slug) ? slugMap[slug] : undefined;
  if (id) return { kind: "page", id, slug };
  return { kind: "notfound" };
}
