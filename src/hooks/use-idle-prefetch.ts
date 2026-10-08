"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

/** Veri tasarrufu açık ya da 2g/slow-2g bağlantıda ön ısıtma yapılmaz. */
export function canPrefetchOnThisConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  if (conn?.saveData) return false;
  return !/(^|-)2g$/.test(conn?.effectiveType ?? "");
}

/**
 * Verilen hedefleri tarayıcı BOŞTAYKEN (requestIdleCallback) sırayla ısıtır (en çok `max`, 600 ms arayla).
 * /app ve /admin rotalarının hepsinde `loading.tsx` vardır: prefetch yalnız statik kabuğa kadar iner (tam sunucu render'ı
 * değil), bant genişliği abartılmaz. Görsel çıktısı yoktur; hedef listesi aynıysa yeniden çalışmaz.
 */
export function useIdlePrefetch(hrefs: readonly string[], max = 4): void {
  const router = useRouter();
  const key = hrefs.join("|");
  useEffect(() => {
    if (!key || !canPrefetchOnThisConnection()) return;
    const cancels = key
      .split("|")
      .slice(0, max)
      .map((href, i) => runWhenIdle(() => router.prefetch(href), 1500 + i * 600));
    return () => cancels.forEach((c) => c());
  }, [key, max, router]);
}
