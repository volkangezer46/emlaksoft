"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { canPrefetchOnThisConnection, enqueueFullPrefetch } from "@/lib/client-prefetch";

export { canPrefetchOnThisConnection };

/**
 * Verilen hedefleri tarayıcı BOŞTAYKEN TAM veriyle (full prefetch) sırayla önceden yükler: tek ortak kuyruk,
 * aynı anda en çok 2 istek, aralıklı (bkz. `@/lib/client-prefetch`). Veri tasarrufu / 2g-3g ağda yapılmaz.
 * Görsel çıktısı yoktur; hedef listesi aynıysa yeniden çalışmaz. `max` kuyruğa alınacak en çok hedef sayısıdır.
 */
export function useIdlePrefetch(hrefs: readonly string[], max = 12): void {
  const router = useRouter();
  const key = hrefs.join("|");
  useEffect(() => {
    if (!key) return;
    return enqueueFullPrefetch(router, key.split("|").slice(0, max));
  }, [key, max, router]);
}
