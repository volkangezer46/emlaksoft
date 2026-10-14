import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { now } from "@/lib/clock";
import { runWhenIdle } from "@/lib/idle";
import { markFetched } from "@/lib/client-cache-state";
import {
  networkAllowsPrefetch,
  PREFETCH_CONCURRENCY,
  PREFETCH_MIN_REPEAT_MS,
  PREFETCH_SLOT_MS,
  IDLE_PREFETCH_SESSION_CAP,
} from "@/lib/client-cache-policy";

/**
 * TAM önceden yükleme (full prefetch): router.prefetch(href, { kind: "full" }) sayfanın TÜM veriyle çizilmiş
 * RSC yanıtını istemci önbelleğine indirir; tıklamada ağ turu yoktur (Next 16.3: PrefetchKind.FULL, `static`
 * staleTimes süresi = 300 sn). Sunucu yükü: tek kuyruk, aynı anda en çok 2 istek, 700 ms aralık, aynı adres
 * 30 sn içinde tekrarlanmaz; önbellek geçersiz kılınınca (router.refresh / mutasyon) `onInvalidate` ile istenen
 * hedefler 1,5 sn sonra, en sık 10 sn'de bir, aynı kuyruğa toplu geri alınır (sunucu yükü sınırlı).
 *
 * AĞIR SAYFALAR (KQ5): `IDLE_PARTIAL_PATHS` (müşteriler, komisyon, raporlar) boşta yalnız KISMİ önceden yüklenir
 * (kind "auto": `loading.tsx` sınırına kadar kabuk; sunucu sorguları çalışmaz). Bu sayfaların TAM yüklemesi yalnız
 * niyetle (hover / odak / dokunma: `prefetchFullNow`) yapılır; ana ekran açılışında arka planda ağır RSC inmez.
 */

export type PrefetchRouter = {
  prefetch: (href: string, options: { kind: PrefetchKind; onInvalidate?: () => void }) => void;
};

const FULL = "full" as unknown as PrefetchKind;
const AUTO = "auto" as unknown as PrefetchKind;

/** Boşta yalnız KISMİ önceden yüklenen ağır merkezler (tam yükleme yalnız niyetle). */
export const IDLE_PARTIAL_PATHS: readonly string[] = ["/app/musteriler", "/app/komisyon", "/app/raporlar"];

/** Adres boşta kısmi mi yüklenmeli? (yol eşleşmesi; sorgu dizesi ve # yok sayılır, detay alt yolları ağır sayılmaz) */
export function isIdlePartialHref(href: string): boolean {
  const path = href.split("#", 1)[0]!.split("?", 1)[0]!.replace(/\/+$/, "");
  return IDLE_PARTIAL_PATHS.includes(path);
}

/** Boş kuyrukta kullanılacak önceden yükleme türü. */
export function idlePrefetchKind(href: string): "full" | "auto" {
  return isIdlePartialHref(href) ? "auto" : "full";
}

type Item = { href: string; router: PrefetchRouter };
const queue: Item[] = [];
/** Son TAM önceden yükleme zamanı (adres başına). */
const lastAt = new Map<string, number>();
/** Son KISMİ önceden yükleme zamanı (yalnız ağır sayfalar; niyetle tam yüklemeyi engellemez). */
const lastPartialAt = new Map<string, number>();
const wanted = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function canPrefetchOnThisConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  return networkAllowsPrefetch((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection);
}

function isLocalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function keyOf(href: string): string {
  const [path, query = ""] = href.split("#", 1)[0].split("?");
  return `${path}?${query}`;
}

function fire(router: PrefetchRouter, href: string): void {
  lastAt.set(href, now());
  markFetched(keyOf(href));
  try {
    // Toplu yeniden ısıtma KAPALI: önbellek düşünce bir sonraki tıklama sunucudan gelir (onInvalidate yok).
    router.prefetch(href, { kind: FULL });
  } catch {
    /* önceden yükleme en iyi çabadır; hata gezinmeyi etkilemez */
  }
}

/** Kısmi önceden yükleme: veri önbelleğe girmez, bu yüzden `markFetched` işaretlenmez (gelişte tazeleme kararı bozulmaz). */
function firePartial(router: PrefetchRouter, href: string): void {
  lastPartialAt.set(href, now());
  try {
    router.prefetch(href, { kind: AUTO });
  } catch {
    /* en iyi çaba */
  }
}

function recentlyDone(href: string, partial: boolean): boolean {
  const t = now();
  const full = lastAt.get(href);
  if (full !== undefined && t - full < PREFETCH_MIN_REPEAT_MS) return true;
  if (!partial) return false;
  const part = lastPartialAt.get(href);
  return part !== undefined && t - part < PREFETCH_MIN_REPEAT_MS;
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
    const item = queue.shift()!;
    const partial = isIdlePartialHref(item.href);
    if (recentlyDone(item.href, partial)) continue;
    if (partial) firePartial(item.router, item.href);
    else fire(item.router, item.href);
    started++;
  }
  if (queue.length > 0) timer = setTimeout(pump, PREFETCH_SLOT_MS);
}

/**
 * Boşta, sırayla, aralıklı önceden yükleme: ağır sayfalar (`IDLE_PARTIAL_PATHS`) KISMİ, diğerleri TAM.
 * Veri tasarrufu / yavaş ağda hiçbir şey yapmaz.
 */
export function enqueueIdlePrefetch(router: PrefetchRouter, hrefs: readonly string[]): () => void {
  if (!canPrefetchOnThisConnection()) return () => {};
  const added: Item[] = [];
  for (const href of hrefs) {
    if (!isLocalPath(href)) continue;
    if (!wanted.has(href) && wanted.size >= IDLE_PREFETCH_SESSION_CAP) break;
    wanted.add(href);
    if (queue.some((q) => q.href === href)) continue;
    const item = { href, router };
    queue.push(item);
    added.push(item);
  }
  const cancelIdle = runWhenIdle(() => {
    if (timer === null && queue.length > 0) timer = setTimeout(pump, 0);
  });
  return () => {
    cancelIdle();
    for (const item of added) {
      const i = queue.indexOf(item);
      if (i >= 0) queue.splice(i, 1);
    }
  };
}

/** Niyet (hover / odak / dokunma / görünür alan): kuyruğu beklemeden TAM, ama aynı adres tekrar süresinde bir kez. */
export function prefetchFullNow(router: PrefetchRouter | null | undefined, href: string): void {
  if (!router || !isLocalPath(href) || !canPrefetchOnThisConnection()) return;
  if (recentlyDone(href, false)) return;
  fire(router, href);
}

/** Çıkış / kimlik değişimi: kuyruk ve bellek durumu sıfırlanır. */
export function resetPrefetchState(): void {
  queue.length = 0;
  lastAt.clear();
  lastPartialAt.clear();
  wanted.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}

// --- Liste satırı görünür-alan bütçesi (ilk 5 detay bağlantısı) ---
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
