import { isStaticEligiblePath, staticRouteByPath, type StaticRouteId } from "@/lib/static-home/registry";

/**
 * Statik sayfa (saf HTML + küçük adacıklar) yalnız TAM SAYFA belge isteklerinde sunulur.
 * Next istemci gezinmesi (RSC/önceden yükleme), kaynak çekimi (`STATIC_HOME_SOURCE_HEADER`), env kapatması ve kayıt
 * defterinde olmayan / kapalı yollar her zaman normal Next sayfasına gider. Ayrıntı: src/app/api/statik/sayfa/[id]/route.ts.
 */
/** Rota işleyicisinin kaynak HTML'i normal Next sayfasından çekerken koyduğu başlık (yeniden yazmayı atlatır). */
export const STATIC_HOME_SOURCE_HEADER = "x-emlaksoft-static-src";

type HeaderLike = { get(name: string): string | null };

/**
 * İstek statik sürüme yeniden yazılmalı mı? Evet ise kayıt kimliği, değilse null.
 * `enabledIds` proxy'nin bayrak okumasından gelir (settings.ts `enabledStaticIds`; env kapatması orada uygulanmıştır).
 */
export function staticRewriteTarget(
  req: {
    method: string;
    pathname: string;
    searchParams: { has(name: string): boolean };
    headers: HeaderLike;
    env?: Readonly<Record<string, string | undefined>>;
  },
  enabledIds: ReadonlySet<string>,
): StaticRouteId | null {
  const env = req.env ?? process.env;
  if (env.NODE_ENV !== "production" || env.STATIC_HOME?.trim().toLowerCase() === "off") return null;
  // Vercel (yedek ortam): rota işleyicisinin iç kaynak çağrısı (127.0.0.1) orada yok → normal Next sayfası.
  if (env.VERCEL) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  // Üyelik/oturum yolları kayıt defterine giremez; yine de karar burada ikinci kez kapatılır.
  if (!isStaticEligiblePath(req.pathname)) return null;
  const route = staticRouteByPath(req.pathname);
  if (!route || route.disabled || !enabledIds.has(route.id)) return null;
  if (req.searchParams.has("_rsc")) return null;
  const h = req.headers;
  if (h.get("rsc") || h.get("next-router-prefetch") || h.get("next-router-state-tree") || h.get(STATIC_HOME_SOURCE_HEADER)) return null;
  return route.id;
}
