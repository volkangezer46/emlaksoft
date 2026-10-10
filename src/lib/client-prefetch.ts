import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { now } from "@/lib/clock";
import { runWhenIdle } from "@/lib/idle";
import {
  networkAllowsPrefetch,
  PREFETCH_CONCURRENCY,
  PREFETCH_MIN_REPEAT_MS,
  PREFETCH_SLOT_MS,
} from "@/lib/client-cache-policy";

/**
 * TAM önceden yükleme (full prefetch): router.prefetch(href, { kind: "full" }) sayfanın TÜM veriyle çizilmiş
 * RSC yanıtını istemci önbelleğine indirir; tıklamada ağ turu yoktur (Next 16.3: PrefetchKind.FULL, `static`
 * staleTimes süresi = 300 sn). Sunucu yükü: tek kuyruk, aynı anda en çok 2 istek, 700 ms aralık, aynı adres
 * 30 sn içinde tekrarlanmaz; önbellek geçersiz kılınınca (router.refresh / mutasyon) `onInvalidate` ile aynı
 * kuyruğa gecikmeli geri alınır.
 */

export type PrefetchRouter = {
  prefetch: (href: string, options: { kind: PrefetchKind; onInvalidate?: () => void }) => void;
};

const FULL = "full" as unknown as PrefetchKind;

type Item = { href: string; router: PrefetchRouter };
const queue: Item[] = [];
const lastAt = new Map<string, number>();
const wanted = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function canPrefetchOnThisConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  return networkAllowsPrefetch((navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection);
}

function isLocalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

function fire(router: PrefetchRouter, href: string): void {
  lastAt.set(href, now());
  wanted.add(href);
  try {
    router.prefetch(href, {
      kind: FULL,
      onInvalidate: () => {
        // Önbellek düştü: hâlâ isteniyorsa gecikmeli ve kuyruktan yeniden yükle (fırtına olmasın).
        if (!wanted.has(href)) return;
        setTimeout(() => enqueueFullPrefetch(router, [href]), PREFETCH_MIN_REPEAT_MS);
      },
    });
  } catch {
    /* önceden yükleme en iyi çabadır; hata gezinmeyi etkilemez */
  }
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
    const last = lastAt.get(item.href);
    if (last !== undefined && now() - last < PREFETCH_MIN_REPEAT_MS) continue;
    fire(item.router, item.href);
    started++;
  }
  if (queue.length > 0) timer = setTimeout(pump, PREFETCH_SLOT_MS);
}

/** Boşta, sırayla, aralıklı tam önceden yükleme. Veri tasarrufu / yavaş ağda hiçbir şey yapmaz. */
export function enqueueFullPrefetch(router: PrefetchRouter, hrefs: readonly string[]): () => void {
  if (!canPrefetchOnThisConnection()) return () => {};
  const added: Item[] = [];
  for (const href of hrefs) {
    if (!isLocalPath(href)) continue;
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

/** Niyet (hover / odak / dokunma / görünür alan): kuyruğu beklemeden, ama aynı adres 30 sn'de bir. */
export function prefetchFullNow(router: PrefetchRouter | null | undefined, href: string): void {
  if (!router || !isLocalPath(href) || !canPrefetchOnThisConnection()) return;
  const last = lastAt.get(href);
  if (last !== undefined && now() - last < PREFETCH_MIN_REPEAT_MS) return;
  fire(router, href);
}

/** Çıkış / kimlik değişimi: kuyruk ve bellek durumu sıfırlanır. */
export function resetPrefetchState(): void {
  queue.length = 0;
  lastAt.clear();
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
