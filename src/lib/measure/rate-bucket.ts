/**
 * Ölçüm işaretçisi için SÜREÇ İÇİ token kovası. Veritabanına HİÇ gitmez (her beacon'da DB turu yok — `checkRateLimit`
 * bilerek kullanılmaz). Anahtar (IP) yalnız bellekte, en çok 60 sn boşta kalır; hash'lenmez, loglanmaz, saklanmaz.
 * En çok 10.000 anahtar: dolunca önce süresi geçenler, yetmezse en eski anahtar atılır (bellek sınırlı kalır).
 */
export type RateBucketOptions = {
  /** Patlama kapasitesi (token). */
  capacity?: number;
  /** Saniyede eklenen token. */
  refillPerSec?: number;
  /** Boşta kalan anahtarın ömrü (ms). */
  ttlMs?: number;
  maxKeys?: number;
};

type Entry = { tokens: number; at: number };

export function createRateBucket(opts: RateBucketOptions = {}) {
  const capacity = opts.capacity ?? 10;
  const refill = opts.refillPerSec ?? 1;
  const ttl = opts.ttlMs ?? 60_000;
  const maxKeys = opts.maxKeys ?? 10_000;
  const map = new Map<string, Entry>();

  function sweep(nowMs: number) {
    for (const [k, e] of map) if (nowMs - e.at > ttl) map.delete(k);
  }

  return {
    /** Bir token harcar; izin varsa true. */
    take(key: string, nowMs: number): boolean {
      let e = map.get(key);
      if (e && nowMs - e.at > ttl) {
        map.delete(key);
        e = undefined;
      }
      if (!e) {
        if (map.size >= maxKeys) {
          sweep(nowMs);
          if (map.size >= maxKeys) {
            const oldest = map.keys().next().value;
            if (oldest !== undefined) map.delete(oldest);
          }
        }
        map.set(key, { tokens: capacity - 1, at: nowMs });
        return true;
      }
      const tokens = Math.min(capacity, e.tokens + (Math.max(0, nowMs - e.at) / 1000) * refill);
      // Yeniden ekleme: Map sırası "en son kullanılan sonda" olur (en eski atılırken etkin anahtar korunur).
      map.delete(key);
      if (tokens < 1) {
        map.set(key, { tokens, at: nowMs });
        return false;
      }
      map.set(key, { tokens: tokens - 1, at: nowMs });
      return true;
    },
    size(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
  };
}

/** Uygulama geneli tek kova: IP başına 10 patlama, saniyede 1 token (normal sayfa 1-2 gönderim yapar). */
export const beaconBucket = createRateBucket();
