/**
 * Statik ana sayfa (saf HTML + küçük adacıklar) yalnız TAM SAYFA belge isteklerinde sunulur.
 * Next istemci gezinmesi (RSC/önceden yükleme), kaynak çekimi (`STATIC_HOME_SOURCE_HEADER`) ve
 * `STATIC_HOME=off` her zaman normal Next sayfasına gider. Ayrıntı: src/app/api/statik/ana-sayfa/route.ts.
 */
export const STATIC_HOME_ROUTE = "/api/statik/ana-sayfa";
/** Rota işleyicisinin kaynak HTML'i normal Next sayfasından çekerken koyduğu başlık (yeniden yazmayı atlatır). */
export const STATIC_HOME_SOURCE_HEADER = "x-emlaksoft-static-src";

type HeaderLike = { get(name: string): string | null };

export function wantsStaticHome(req: {
  method: string;
  pathname: string;
  searchParams: { has(name: string): boolean };
  headers: HeaderLike;
  env?: Readonly<Record<string, string | undefined>>;
}): boolean {
  const env = req.env ?? process.env;
  if (env.NODE_ENV !== "production" || env.STATIC_HOME?.trim().toLowerCase() === "off") return false;
  if (req.pathname !== "/" || (req.method !== "GET" && req.method !== "HEAD")) return false;
  if (req.searchParams.has("_rsc")) return false;
  const h = req.headers;
  if (h.get("rsc") || h.get("next-router-prefetch") || h.get("next-router-state-tree") || h.get(STATIC_HOME_SOURCE_HEADER)) return false;
  return true;
}
