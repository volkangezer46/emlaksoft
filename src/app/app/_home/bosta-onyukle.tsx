"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

/**
 * Ana ekranda en olası 3-4 hedefi tarayıcı BOŞTAYKEN (requestIdleCallback) önceden ısıtır. Bu rotaların hepsinde
 * `loading.tsx` vardır: prefetch yalnız statik kabuğa kadar iner (tam sunucu render'ı değil), bant genişliği abartılmaz.
 * Veri tasarrufu açık ya da yavaş bağlantıda hiçbir şey yapmaz. Görsel çıktısı yoktur.
 */
export function BostaOnyukle({ hrefs }: { hrefs: string[] }) {
  const router = useRouter();
  const key = hrefs.join("|");
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: NetworkInfo }).connection;
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "")) return;
    const targets = key ? key.split("|") : [];
    const cancels = targets.slice(0, 4).map((href, i) =>
      runWhenIdle(() => router.prefetch(href), 1500 + i * 600),
    );
    return () => cancels.forEach((c) => c());
  }, [key, router]);
  return null;
}
