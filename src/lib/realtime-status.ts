/**
 * Ofis canlı kanalının durum deposu (bağımlılıksız, istemci ilk yükünde güvenle bulunabilir).
 *
 * `src/lib/realtime.ts` (konu hub'ı + realtime-throttle, ~40 KB kaynak) yalnız abonelik kuran bileşenlerle (tembel
 * yüklenen RealtimeRefresh, zil) gelir; her sayfa başlığındaki DataFreshness damgası durumu BURADAN okur. Böylece sayfa
 * başlığı realtime çekirdeğini her rotanın ilk yüküne taşımaz. Hub, ofis konusunun durumu her değiştiğinde
 * `publishRealtimeStatus` ile yazar; hub hiç kurulmadıysa durum "idle" kalır (bu sayfada canlı kanal yok).
 */
export type RealtimeStatus = "idle" | "connecting" | "live" | "offline";

let status: RealtimeStatus = "idle";
let since = 0;
const listeners = new Set<() => void>();

/** Ofis konusunun canlı bağlantı durumu ("idle": bu sayfada ofis aboneliği yok, ör. /admin). */
export function getRealtimeStatus(): RealtimeStatus {
  return status;
}

/** Ofis konusu durumunun en son değiştiği an (bağlanamama süresi; DataFreshness toleransı). */
export function getRealtimeStatusSince(): number {
  return since;
}

export function subscribeRealtimeStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Hub yazar: durum ve değişim anı birlikte güncellenir, dinleyiciler bir kez uyarılır. */
export function publishRealtimeStatus(next: RealtimeStatus, at: number): void {
  if (next === status && at === since) return;
  status = next;
  since = at;
  listeners.forEach((cb) => cb());
}
