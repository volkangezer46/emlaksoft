"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { canPrefetchOnThisConnection, enqueueIdlePrefetch, type PrefetchTier } from "@/lib/client-prefetch";

export { canPrefetchOnThisConnection };

/**
 * Verilen hedefleri tarayıcı BOŞTAYKEN öncelik sırasıyla önceden yükler: tek ortak kuyruk, aynı anda en çok 2 istek,
 * aralıklı (bkz. `@/lib/client-prefetch`). `tier`: `siblings` (varsayılan; etkin merkezin kardeş sekmeleri, TAM veri),
 * `hubs` (rolün menü merkezleri: ilk 3'ü TAM, kalanı yalnız rota ağacı), `tree` (yalnız rota ağacı). Her kademenin
 * ayrı bütçesi vardır; kardeş sekmeler menü merkezlerinden ÖNCE yüklenir. Veri tasarrufu / 2g-3g ağda yapılmaz.
 * Görsel çıktısı yoktur; hedef listesi aynıysa yeniden çalışmaz. `max` kuyruğa alınacak en çok hedef sayısıdır
 * (imza korunur: `useIdlePrefetch(hrefs, max)`; kademe isteğe bağlı üçüncü parametredir).
 */
export function useIdlePrefetch(hrefs: readonly string[], max = 12, options: { tier?: PrefetchTier } = {}): void {
  const router = useRouter();
  const key = hrefs.join("|");
  const tier = options.tier ?? "siblings";
  useEffect(() => {
    if (!key) return;
    return enqueueIdlePrefetch(router, key.split("|").slice(0, max), tier);
  }, [key, max, router, tier]);
}
