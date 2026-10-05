/**
 * Realtime yenileme için saf yardımcılar (hook'tan ayrı: test edilebilir).
 *
 * Sorun: ofisteki her açık oturum deals/commissions/portal_listings/customers
 * değişiminde router.refresh() yapıyordu; toplu işlem (içe aktarma, toplu
 * atama) N oturum x M olay = sorgu fırtınası üretiyordu.
 *
 * Çözüm: (1) olay yalnız açık sayfayı ilgilendiren tablolardan geliyorsa dikkate
 * alınır, (2) iki yenileme arası en az REALTIME_MIN_INTERVAL_MS, (3) bekleyen
 * yenileme varken gelen olaylar BİRLEŞTİRİLİR (zamanlayıcı yeniden kurulmaz).
 */

export const REALTIME_MIN_INTERVAL_MS = 10_000;

/** Tüm kritik tablolar (kanal aboneliği bu kümeye yapılır; abonelik rota değişince bozulmaz). */
export const REALTIME_ALL_TABLES = ["deals", "commissions", "portal_listings", "customers"] as const;

const ROUTE_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/app/musteriler", ["customers"]],
  ["/app/komisyon", ["commissions"]],
  ["/app/anlasmalar", ["deals", "commissions"]],
  ["/app/portallar", ["portal_listings"]],
  ["/app/portfoyler", ["portal_listings"]],
];

/** Açık rotada tazelenmesi anlamlı tablolar. Ana pano tümünü gösterir; bilinmeyen rota hiçbirini. */
export function tablesForPath(pathname: string | null | undefined): readonly string[] {
  const p = (pathname ?? "").split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (p === "/app") return REALTIME_ALL_TABLES;
  for (const [prefix, tables] of ROUTE_TABLES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return tables;
  }
  return [];
}

/**
 * Bir olay geldiğinde yenilemeden önce beklenecek süre (ms).
 * Hiç yenileme yapılmadıysa yalnız debounce; yakın zamanda yapıldıysa
 * son yenilemeden itibaren minInterval dolana kadar bekler.
 */
export function computeRefreshDelay(
  nowMs: number,
  lastRefreshAtMs: number | null,
  debounceMs: number,
  minIntervalMs: number = REALTIME_MIN_INTERVAL_MS,
): number {
  if (lastRefreshAtMs === null) return Math.max(0, debounceMs);
  const untilAllowed = lastRefreshAtMs + minIntervalMs - nowMs;
  return Math.max(0, debounceMs, untilAllowed);
}
