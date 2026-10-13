import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * Statik sayfa bellek önbelleği (kimlik başına; SAF çekirdek — G/Ç bağımlılıkları enjekte edilir, birim testli).
 *
 *  - Anahtar = kayıt kimliği (sorgu dizesi hiçbir zaman anahtara girmez). LRU en çok 32 girdi.
 *  - `inflight` kimlik başına: aynı anda gelen istekler tek çizimi bekler.
 *  - 60 sn taze; sonra eski içerik sunulur ve arka planda yenilenir (SWR).
 *  - `invalidate(id|'all')`: girdiyi ve süren çizimi düşürür (süren çizimin sonucu önbelleğe YAZILMAZ) → sonraki ilk
 *    istek yeniden çizer (yeni ETag).
 *  - `statik.rev`: en çok 5 sn'de bir okunur; değer bu sürecin gördüğünden farklıysa TÜM önbellek düşer (başka süreçte
 *    yapılan yayın/temizleme bu süreci de tazeler). Okuma hatası önbelleği düşürmez.
 */
export type RenderOutcome = { html: string; isStatic: boolean; reason?: string | null };

export type CachedPage = {
  html: string;
  etag: string;
  at: number;
  isStatic: boolean;
  rawBytes: number;
  gzipBytes: number;
  renderMs: number;
};

export type StaticCacheStats = {
  lastRenderAt: number | null;
  lastRenderMs: number | null;
  lastStatic: boolean | null;
  rawBytes: number | null;
  gzipBytes: number | null;
  lastFallbackAt: number | null;
  lastFallbackReason: string | null;
  lastErrorAt: number | null;
  lastError: string | null;
};

export type StaticCacheDeps = {
  render: (id: string) => Promise<RenderOutcome>;
  nowMs: () => number;
  /** `statik.rev` okuması (null = okunamadı). */
  readRev?: () => Promise<number | null>;
  freshMs?: number;
  revTtlMs?: number;
  maxEntries?: number;
};

export const STATIC_FRESH_MS = 60_000;
export const STATIC_REV_TTL_MS = 5_000;
export const STATIC_MAX_ENTRIES = 32;

export function etagOf(html: string): string {
  return `"${createHash("sha1").update(html).digest("base64url").slice(0, 20)}"`;
}

const emptyStats = (): StaticCacheStats => ({
  lastRenderAt: null,
  lastRenderMs: null,
  lastStatic: null,
  rawBytes: null,
  gzipBytes: null,
  lastFallbackAt: null,
  lastFallbackReason: null,
  lastErrorAt: null,
  lastError: null,
});

export function createStaticCache(deps: StaticCacheDeps) {
  const freshMs = deps.freshMs ?? STATIC_FRESH_MS;
  const revTtlMs = deps.revTtlMs ?? STATIC_REV_TTL_MS;
  const maxEntries = deps.maxEntries ?? STATIC_MAX_ENTRIES;
  const entries = new Map<string, CachedPage>();
  const inflight = new Map<string, { gen: number; p: Promise<CachedPage> }>();
  const stats = new Map<string, StaticCacheStats>();
  /** Kimlik başına kuşak: invalidate artırır; eski kuşağın çizimi önbelleğe yazılmaz. */
  const gens = new Map<string, number>();
  let globalGen = 0;
  let seenRev: number | null = null;
  let revCheckedAt = Number.NEGATIVE_INFINITY;
  let revInflight: Promise<void> | null = null;

  const genOf = (id: string) => globalGen * 1_000_000 + (gens.get(id) ?? 0);
  const statOf = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = emptyStats()));
    return s;
  };

  function store(id: string, page: CachedPage) {
    entries.delete(id);
    entries.set(id, page);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function refresh(id: string): Promise<CachedPage> {
    const gen = genOf(id);
    const running = inflight.get(id);
    if (running && running.gen === gen) return running.p;
    const startedAt = deps.nowMs();
    const p = deps
      .render(id)
      .then((r) => {
        const at = deps.nowMs();
        const page: CachedPage = {
          html: r.html,
          etag: etagOf(r.html),
          at,
          isStatic: r.isStatic,
          rawBytes: Buffer.byteLength(r.html),
          gzipBytes: gzipSync(r.html, { level: 6 }).length,
          renderMs: Math.max(0, at - startedAt),
        };
        const s = statOf(id);
        s.lastRenderAt = at;
        s.lastRenderMs = page.renderMs;
        s.lastStatic = r.isStatic;
        s.rawBytes = page.rawBytes;
        s.gzipBytes = page.gzipBytes;
        if (!r.isStatic) {
          s.lastFallbackAt = at;
          s.lastFallbackReason = r.reason ?? "bilinmeyen neden";
        }
        if (genOf(id) === gen) store(id, page);
        return page;
      })
      .catch((e: unknown) => {
        const s = statOf(id);
        s.lastErrorAt = deps.nowMs();
        s.lastError = e instanceof Error ? e.message : String(e);
        throw e;
      })
      .finally(() => {
        if (inflight.get(id)?.p === p) inflight.delete(id);
      });
    inflight.set(id, { gen, p });
    return p;
  }

  function invalidate(id: string | "all") {
    if (id === "all") {
      globalGen++;
      entries.clear();
      inflight.clear();
      return;
    }
    gens.set(id, (gens.get(id) ?? 0) + 1);
    entries.delete(id);
    inflight.delete(id);
  }

  /** `statik.rev` değiştiyse tüm önbelleği düşürür (en çok revTtlMs'de bir okur; eşzamanlı çağrılar tek okumayı bekler). */
  async function syncRev(): Promise<void> {
    if (!deps.readRev) return;
    const t = deps.nowMs();
    if (t - revCheckedAt < revTtlMs) return;
    if (!revInflight) {
      revCheckedAt = t;
      revInflight = deps
        .readRev()
        .then((rev) => {
          if (rev === null) return;
          if (seenRev !== null && rev !== seenRev) invalidate("all");
          seenRev = rev;
        })
        .catch(() => {})
        .finally(() => {
          revInflight = null;
        });
    }
    await revInflight;
  }

  /** İstek yolu: önbellekte varsa hemen (eskiyse arka planda yeniler), yoksa çizimi bekler. */
  async function get(id: string): Promise<CachedPage> {
    await syncRev();
    const hit = entries.get(id);
    if (!hit) return refresh(id);
    entries.delete(id);
    entries.set(id, hit);
    if (deps.nowMs() - hit.at > freshMs) void refresh(id).catch(() => {});
    return hit;
  }

  /** Isıtma: girdiyi düşürüp yeniden çizer ve sonucu döndürür. */
  async function warm(id: string): Promise<CachedPage> {
    invalidate(id);
    return refresh(id);
  }

  /** Bu sürecin gördüğü rev'i hemen günceller (kendi yazdığı artıştan sonra çift temizliği önler). */
  function noteRev(rev: number) {
    seenRev = rev;
    revCheckedAt = deps.nowMs();
  }

  function snapshot(id: string): { cached: CachedPage | null; stats: StaticCacheStats } {
    return { cached: entries.get(id) ?? null, stats: { ...statOf(id) } };
  }

  return { get, warm, invalidate, noteRev, snapshot, size: () => entries.size };
}

export type StaticCache = ReturnType<typeof createStaticCache>;

/**
 * "Tümünü temizle ve ısıt" kilidi (F6): süreç başına tek koşu ve dakikada en çok 1 başlatma. SAF (saat enjekte edilir).
 * `tryAcquire` reddederse nedenini döndürür; koşu bitince `release` çağrılır (başarısız koşu da aralığı doldurur).
 */
export function createWarmLock(deps: { nowMs: () => number; minIntervalMs?: number }) {
  const minIntervalMs = deps.minIntervalMs ?? 60_000;
  let running = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  return {
    tryAcquire(): { ok: true } | { ok: false; reason: "running" | "too_soon"; retryInSec: number } {
      if (running) return { ok: false, reason: "running", retryInSec: 5 };
      const t = deps.nowMs();
      const wait = lastStart + minIntervalMs - t;
      if (wait > 0) return { ok: false, reason: "too_soon", retryInSec: Math.ceil(wait / 1000) };
      running = true;
      lastStart = t;
      return { ok: true };
    },
    release() {
      running = false;
    },
    isRunning: () => running,
  };
}

/** Sıra korunarak en çok `limit` eşzamanlı iş (F6: paralellik 2). */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
