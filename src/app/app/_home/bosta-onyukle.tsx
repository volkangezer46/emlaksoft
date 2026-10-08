"use client";

import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";

/**
 * Ana ekranda en olası 3-4 hedefi tarayıcı BOŞTAYKEN (requestIdleCallback) önceden ısıtır. Bu rotaların hepsinde
 * `loading.tsx` vardır: prefetch yalnız statik kabuğa kadar iner (tam sunucu render'ı değil), bant genişliği abartılmaz.
 * Veri tasarrufu açık ya da yavaş bağlantıda hiçbir şey yapmaz. Görsel çıktısı yoktur.
 * (Mantık `useIdlePrefetch` kancasında: Hızlı erişim menüsüyle ortak.)
 */
export function BostaOnyukle({ hrefs }: { hrefs: string[] }) {
  useIdlePrefetch(hrefs, 4);
  return null;
}
