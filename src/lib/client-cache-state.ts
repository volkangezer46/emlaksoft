import { now } from "@/lib/clock";

/**
 * Oturum içi (bellek) "bu adresin verisi ne zaman çekildi" kaydı. Yalnız istemci önbelleği tazelik kararı içindir
 * (bkz. `client-cache-policy.ts`, `components/app/client-cache-sync.tsx`); sayfa yenilenince sıfırlanır.
 */
const fetchedAt = new Map<string, number>();
let lastBgRefresh: number | null = null;

export function getFetchedAt(key: string): number | undefined {
  return fetchedAt.get(key);
}

export function markFetched(key: string): void {
  fetchedAt.set(key, now());
}

export function getLastBgRefreshAt(): number | null {
  return lastBgRefresh;
}

export function markBgRefresh(): void {
  lastBgRefresh = now();
}

/** router.refresh() TÜM segment önbelleğini geçersiz kılar: yalnız tazelenen adres yeni, diğerleri bilinmiyor. */
export function noteClientCacheRefreshed(key: string): void {
  fetchedAt.clear();
  fetchedAt.set(key, now());
}

export function clearClientCacheState(): void {
  fetchedAt.clear();
  lastBgRefresh = null;
}
