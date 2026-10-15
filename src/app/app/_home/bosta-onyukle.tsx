"use client";

import { useIdlePrefetch } from "@/hooks/use-idle-prefetch";

/**
 * Ana ekranda en olası 3-4 hedefi tarayıcı BOŞTAYKEN önceden ısıtır: "merkez" kademesinde (ilk 3'ü TAM veriyle, kalanı
 * yalnız rota ağacı; kardeş sekmelerden SONRA). Yan menünün aynı hedefleri kuyrukta tekilleşir (iki kez çekilmez).
 * Veri tasarrufu açık ya da yavaş bağlantıda hiçbir şey yapmaz. Görsel çıktısı yoktur.
 * (Mantık `useIdlePrefetch` / `@/lib/client-prefetch`: yan menü ve sekme şeridiyle ortak kuyruk.)
 */
export function BostaOnyukle({ hrefs }: { hrefs: string[] }) {
  useIdlePrefetch(hrefs, 4, { tier: "hubs" });
  return null;
}
