import { now } from "@/lib/clock";

/**
 * Oturum içi (bellek) "bu adresin verisi ne zaman çekildi" kaydı. Yalnız istemci önbelleği tazelik kararı içindir
 * (bkz. `client-cache-policy.ts`, `components/app/client-cache-sync.tsx`); sayfa yenilenince sıfırlanır.
 */
const fetchedAt = new Map<string, number>();
/** Rota öneki → bu rotanın verisini değiştiren son olay anı (realtime olayı / bildirim bağlantısı; B010). */
const invalidated = new Map<string, number>();
let lastBgRefresh: number | null = null;
let arrivals = 0;

/**
 * SÖZLEŞME (a): istemci router önbelleği tamamen düştüğünde (router.refresh) `noteClientCacheRefreshed` bu olayı yayar.
 * Önceden yükleme katmanı dinler ve "yakın zamanda ısıtıldı" kayıtlarını siler (düşen sayfalar yeniden ısıtılabilsin;
 * B012). detail: `{ key }` = tazelenen adres.
 */
export const CLIENT_CACHE_REFRESHED_EVENT = "es:client-cache-refreshed";
export type ClientCacheRefreshedDetail = { key: string };

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

/** Bu sayfa yüklemesinde ilk varış mı? (ilk çağrı true; sayfa yüklemesi veriyi canlı çekti) */
export function takeFirstArrival(): boolean {
  arrivals += 1;
  return arrivals === 1;
}

/** router.refresh() TÜM segment önbelleğini geçersiz kılar: yalnız tazelenen adres yeni, diğerleri bilinmiyor. */
export function noteClientCacheRefreshed(key: string): void {
  fetchedAt.clear();
  fetchedAt.set(key, now());
  // Önbellek düştü: sonraki gezinme veriyi sunucudan çeker; eski geçersizleme kayıtlarının anlamı kalmadı.
  invalidated.clear();
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent<ClientCacheRefreshedDetail>(CLIENT_CACHE_REFRESHED_EVENT, { detail: { key } }));
  }
}

/**
 * Kapalı rotaların önbelleği eskidi (realtime olayı o rotanın tablosuna dokundu ya da bildirim bağlantısı o rotayı
 * gösteriyor): o rotaya dönüşte önbellekten gösterilen sayfa arkadan tazelenir. Önek "/app" yalnız tam eşleşir.
 */
export function invalidateClientCache(prefixes: readonly string[]): void {
  if (prefixes.length === 0) return;
  const t = now();
  for (const p of prefixes) invalidated.set(p, t);
}

/** Adresin (yol + sorgu) bağlı olduğu rotalar için en son geçersizleme anı. */
export function getInvalidatedAt(key: string): number | undefined {
  const path = key.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  let latest: number | undefined;
  for (const [prefix, at] of invalidated) {
    const hit = prefix === "/app" ? path === "/app" : path === prefix || path.startsWith(`${prefix}/`);
    if (hit && (latest === undefined || at > latest)) latest = at;
  }
  return latest;
}

export function clearClientCacheState(): void {
  fetchedAt.clear();
  invalidated.clear();
  lastBgRefresh = null;
}
