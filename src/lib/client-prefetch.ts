import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { now } from "@/lib/clock";
import { runWhenIdle } from "@/lib/idle";
import { markFetched } from "@/lib/client-cache-state";
import {
  networkAllowsPrefetch,
  PREFETCH_CONCURRENCY,
  PREFETCH_MIN_REPEAT_MS,
  PREFETCH_SLOT_MS,
  REWARM_DELAY_MS,
  REWARM_MIN_GAP_MS,
} from "@/lib/client-cache-policy";

/**
 * Önceden yükleme kuyruğu (B024 / B012). İki tür istek:
 *  - TAM (full): `router.prefetch(href, { kind: "full" })` sayfanın TÜM veriyle çizilmiş RSC yanıtını istemci önbelleğine
 *    indirir; tıklamada ağ turu yoktur (Next 16.3: PrefetchKind.FULL, `static` staleTimes süresi = 300 sn).
 *  - ROTA AĞACI (tree): `kind: "auto"`; dinamik rotada sunucu yalnız rota ağacını + hedefin kendi `loading.tsx`
 *    sınırını döndürür (sayfa sorguları ÇALIŞMAZ). Önyüklenmemiş merkeze tıklayınca hedefin KENDİ iskeleti anında gelir.
 *
 * ÖNCELİK KUYRUĞU (kademe başına ayrı bütçe; tek ortak kuyruk, aynı anda en çok 2 istek, 700 ms aralık):
 *  0. `siblings` — etkin merkezin kardeş sekmeleri (TAM): sekme tıklaması < 150 ms.
 *  1. `hubs`     — rolün menüsündeki ilk 2-3 merkez (TAM).
 *  2. `tree`     — kalan menü merkezleri (yalnız rota ağacı; ucuz).
 * Yalnız çağıranın verdiği (sunucuda yetki + paket kilidi + kapalı modül süzgecinden geçmiş) adresler yüklenir.
 * Aynı adres önce kısmi sonra tam ÇEKİLMEZ: TAM kuyruktaki ya da yakın zamanda TAM çekilmiş adres ağaç kademesinden
 * düşer; TAM istek gelince aynı adresin bekleyen ağaç isteği silinir.
 *
 * Niyet (hover / odak / dokunma / pointerdown / görünür alan) kuyruğu beklemez: `prefetchFullNow`.
 * Önbellek düşünce (`router.refresh()` TÜM segment önbelleğini geçersiz kılar; `es:client-cache-refreshed` olayı,
 * sözleşme a) "yakın zamanda çekildi" kayıtları temizlenir ve etkin merkezin ilk 3 hedefi 1,5 sn sonra (en sık 10 sn'de
 * bir) yeniden ısıtılır; yoksa önbelleği düşen sayfaya 120 sn boyunca hiçbir önceden yükleme yapılamıyordu.
 */

export type PrefetchRouter = {
  prefetch: (href: string, options: { kind: PrefetchKind; onInvalidate?: () => void }) => void;
};

export type PrefetchTier = "siblings" | "hubs" | "tree";

const FULL = "full" as unknown as PrefetchKind;
const AUTO = "auto" as unknown as PrefetchKind;

/** Kademe sırası (küçük = önce). */
const TIER_RANK: Record<PrefetchTier, number> = { siblings: 0, hubs: 1, tree: 2 };

/**
 * Kademe bütçeleri: bir tam sayfa yüklemesi (modül durumu) boyunca kademe başına en çok bu kadar FARKLI adres.
 * Kardeş sekmeler merkez değiştikçe yenilenir (merkez başına en çok 8, bkz. section-tabs); merkezler 3 TAM + kalanı ağaç.
 */
export const TIER_BUDGET: Record<PrefetchTier, number> = { siblings: 24, hubs: 6, tree: 12 };
/** Rolün menü merkezlerinden boşta TAM yüklenen ilk N (kalanı yalnız rota ağacı; tam yükleme niyetle). */
export const HUB_FULL_COUNT = 3;
/** Önbellek düşünce yeniden ısıtılan etkin merkez hedefi sayısı. */
export const REWARM_COUNT = 3;
/** Boşta başlatma en geç bu kadar ms sonra (requestIdleCallback geç kalırsa girişten sonraki ilk tık beklemesin). */
export const IDLE_START_MAX_MS = 800;
/** Önbellek tazelendi olayı (sözleşme a; `client-cache-state.ts` `noteClientCacheRefreshed` yayar). */
export const CLIENT_CACHE_REFRESHED_EVENT = "es:client-cache-refreshed";

type Item = { href: string; router: PrefetchRouter; tier: PrefetchTier };
const queue: Item[] = [];
/** Son TAM önceden yükleme zamanı (adres başına). */
const lastAt = new Map<string, number>();
/** Son ROTA AĞACI önceden yükleme zamanı. */
const lastPartialAt = new Map<string, number>();
/** Kademe bütçesinden düşülen adresler. */
const spent: Record<PrefetchTier, Set<string>> = { siblings: new Set(), hubs: new Set(), tree: new Set() };
/** Etkin merkezin son kardeş hedefleri (yeniden ısıtma için; en yeni çağrı). */
let activeTargets: { router: PrefetchRouter; hrefs: string[] } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let rewarmTimer: ReturnType<typeof setTimeout> | null = null;
let lastRewarmAt: number | null = null;
/** Olayın dinlendiği pencere (aynı pencereye bir kez kaydolunur). */
let listeningOn: object | null = null;

export function canPrefetchOnThisConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  return networkAllowsPrefetch((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection);
}

function isLocalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function keyOf(href: string): string {
  const [path, query = ""] = href.split("#", 1)[0]!.split("?");
  return `${path}?${query}`;
}

function recentlyFull(href: string): boolean {
  const t = lastAt.get(href);
  return t !== undefined && now() - t < PREFETCH_MIN_REPEAT_MS;
}

function recentlyPartial(href: string): boolean {
  const t = lastPartialAt.get(href);
  return t !== undefined && now() - t < PREFETCH_MIN_REPEAT_MS;
}

function fire(router: PrefetchRouter, href: string): void {
  lastAt.set(href, now());
  markFetched(keyOf(href));
  // Aynı adresin bekleyen ağaç isteği artık gereksiz (kısmi → tam çift çekim yok).
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.href === href && queue[i]!.tier === "tree") queue.splice(i, 1);
  try {
    router.prefetch(href, { kind: FULL });
  } catch {
    /* önceden yükleme en iyi çabadır; hata gezinmeyi etkilemez */
  }
}

/** Rota ağacı: veri önbelleğe girmez, bu yüzden `markFetched` işaretlenmez (gelişte tazeleme kararı bozulmaz). */
function firePartial(router: PrefetchRouter, href: string): void {
  lastPartialAt.set(href, now());
  try {
    router.prefetch(href, { kind: AUTO });
  } catch {
    /* en iyi çaba */
  }
}

/** Ağaç isteği gereksiz mi? (TAM çekildi / TAM kuyrukta / ağaç zaten yakın zamanda çekildi) */
function treeRedundant(href: string): boolean {
  if (recentlyFull(href) || recentlyPartial(href)) return true;
  return queue.some((q) => q.href === href && q.tier !== "tree");
}

/** Sıradaki öğe: en düşük kademe, kademe içinde ekleme sırası. */
function takeNext(): Item | undefined {
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    if (best < 0 || TIER_RANK[queue[i]!.tier] < TIER_RANK[queue[best]!.tier]) best = i;
  }
  return best < 0 ? undefined : queue.splice(best, 1)[0];
}

function pump(): void {
  timer = null;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    // Sekme arkadaysa bekle (sunucu yükü yok); görünür olunca devam.
    timer = setTimeout(pump, PREFETCH_SLOT_MS * 4);
    return;
  }
  let started = 0;
  while (started < PREFETCH_CONCURRENCY && queue.length > 0) {
    const item = takeNext()!;
    if (item.tier === "tree") {
      if (treeRedundant(item.href)) continue;
      firePartial(item.router, item.href);
    } else {
      if (recentlyFull(item.href)) continue;
      fire(item.router, item.href);
    }
    started++;
  }
  if (queue.length > 0) timer = setTimeout(pump, PREFETCH_SLOT_MS);
}

function schedulePump(): () => void {
  let done = false;
  const start = () => {
    if (done) return;
    done = true;
    if (timer === null && queue.length > 0) timer = setTimeout(pump, 0);
  };
  const cancelIdle = runWhenIdle(start);
  const fallback = setTimeout(start, IDLE_START_MAX_MS);
  return () => {
    done = true;
    cancelIdle();
    clearTimeout(fallback);
  };
}

/** Önbellek tazelendi: "yakın zamanda çekildi" kayıtları düşer, etkin merkezin ilk hedefleri kısa süre sonra yeniden ısınır. */
export function noteCacheInvalidated(): void {
  lastAt.clear();
  lastPartialAt.clear();
  if (rewarmTimer) clearTimeout(rewarmTimer);
  rewarmTimer = null;
  const target = activeTargets;
  if (!target || target.hrefs.length === 0) return;
  const t = now();
  if (lastRewarmAt !== null && t - lastRewarmAt < REWARM_MIN_GAP_MS) return;
  lastRewarmAt = t;
  rewarmTimer = setTimeout(() => {
    rewarmTimer = null;
    if (!canPrefetchOnThisConnection()) return;
    for (const href of target.hrefs.slice(0, REWARM_COUNT)) {
      if (queue.some((q) => q.href === href && q.tier !== "tree")) continue;
      queue.push({ href, router: target.router, tier: "siblings" });
    }
    if (timer === null && queue.length > 0) timer = setTimeout(pump, 0);
  }, REWARM_DELAY_MS);
}

function listenForInvalidation(): void {
  if (typeof window === "undefined" || listeningOn === window || typeof window.addEventListener !== "function") return;
  listeningOn = window;
  window.addEventListener(CLIENT_CACHE_REFRESHED_EVENT, noteCacheInvalidated);
}

/**
 * Boşta, öncelikli, aralıklı önceden yükleme. `tier`: `siblings` (etkin merkezin sekmeleri, TAM), `hubs` (ilk
 * `HUB_FULL_COUNT` adres TAM, kalanı ağaç), `tree` (yalnız rota ağacı). Veri tasarrufu / yavaş ağda hiçbir şey yapmaz.
 * Dönen fonksiyon bu çağrının henüz başlamamış isteklerini kuyruktan çıkarır (merkez değişince eski kardeşler düşer).
 */
export function enqueueIdlePrefetch(router: PrefetchRouter, hrefs: readonly string[], tier: PrefetchTier = "siblings"): () => void {
  if (!canPrefetchOnThisConnection()) return () => {};
  listenForInvalidation();
  const local = [...new Set(hrefs.filter(isLocalPath))];
  if (tier === "siblings") activeTargets = { router, hrefs: local };
  const added: Item[] = [];
  local.forEach((href, i) => {
    const itemTier: PrefetchTier = tier === "hubs" && i >= HUB_FULL_COUNT ? "tree" : tier;
    const budget = spent[itemTier];
    if (!budget.has(href) && budget.size >= TIER_BUDGET[itemTier]) return;
    if (queue.some((q) => q.href === href && TIER_RANK[q.tier] <= TIER_RANK[itemTier])) return;
    if (itemTier === "tree" ? treeRedundant(href) : recentlyFull(href)) return;
    budget.add(href);
    // Daha düşük öncelikle bekleyen kopya (ör. ağaç) yükseltilir: aynı adres iki kez çekilmez.
    for (let k = queue.length - 1; k >= 0; k--) if (queue[k]!.href === href) queue.splice(k, 1);
    const item = { href, router, tier: itemTier };
    queue.push(item);
    added.push(item);
  });
  const cancelStart = added.length > 0 ? schedulePump() : () => {};
  return () => {
    cancelStart();
    for (const item of added) {
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

/** Niyet (hover / odak / dokunma / pointerdown / görünür alan): kuyruğu beklemeden TAM, aynı adres tekrar süresinde bir kez. */
export function prefetchFullNow(router: PrefetchRouter | null | undefined, href: string): void {
  if (!router || !isLocalPath(href) || !canPrefetchOnThisConnection()) return;
  listenForInvalidation();
  if (recentlyFull(href)) return;
  fire(router, href);
}

/** Çıkış / kimlik değişimi: kuyruk ve bellek durumu sıfırlanır. */
export function resetPrefetchState(): void {
  queue.length = 0;
  lastAt.clear();
  lastPartialAt.clear();
  for (const s of Object.values(spent)) s.clear();
  activeTargets = null;
  lastRewarmAt = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (rewarmTimer) clearTimeout(rewarmTimer);
  rewarmTimer = null;
  rowBudgetKey = "";
  rowHrefs.clear();
  budgetKey = "";
  budgetUsed = 0;
}

// --- Liste satırı görünür-alan bütçesi (ilk N detay bağlantısı) ---
let budgetKey = "";
let budgetUsed = 0;
export function takeViewportBudget(locationKey: string, limit: number): boolean {
  if (budgetKey !== locationKey) {
    budgetKey = locationKey;
    budgetUsed = 0;
  }
  if (budgetUsed >= limit) return false;
  budgetUsed++;
  return true;
}

// --- İlk satırlar: görünür alanı beklemeden boşta TAM (satırlar çoğu zaman ilk ekranın altında; B047) ---
let rowBudgetKey = "";
const rowHrefs = new Set<string>();
/**
 * Sayfadaki ilk `limit` FARKLI detay adresi için true. Bütçedeki bir adres yeniden sorulursa (aynı satırdaki ikinci
 * bağlantı, yeniden bağlanan efekt) bütçe harcamadan yine true döner; asıl tekilleştirme `prefetchFullNow`'dadır.
 */
export function takeIdleRowBudget(locationKey: string, href: string, limit: number): boolean {
  if (rowBudgetKey !== locationKey) {
    rowBudgetKey = locationKey;
    rowHrefs.clear();
  }
  if (rowHrefs.has(href)) return true;
  if (rowHrefs.size >= limit) return false;
  rowHrefs.add(href);
  return true;
}
