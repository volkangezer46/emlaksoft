"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { computeRefreshDelay } from "@/lib/realtime-throttle";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * HGDekor tarzı: ilgili tabloda değişiklik olunca sayfayı yenile.
 * Tenant izolasyonu RLS + filtre ile; channel adı tenant’a kilitli.
 *
 * Fırtına önleme: iki yenileme arası en az 10 sn; bekleyen yenileme varken
 * gelen olaylar birleştirilir; `relevantTables` verilirse yalnız açık rotayı
 * ilgilendiren tabloların olayları sayılır.
 */
export function useRealtimeRefresh(opts: {
  tenantId: string | null | undefined;
  tables: string[];
  enabled?: boolean;
  debounceMs?: number;
  /** Açık rotaya göre ilgili tablo alt kümesi; verilmezse tüm tablolar ilgilidir. */
  relevantTables?: (pathname: string) => readonly string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAt = useRef<number | null>(null);
  const enabled = opts.enabled !== false && Boolean(opts.tenantId);

  // Güncel rota ve filtre fonksiyonu ref'te: abonelik rota değişince yeniden kurulmaz.
  const pathRef = useRef(pathname);
  const relevantRef = useRef(opts.relevantTables);
  useEffect(() => {
    pathRef.current = pathname;
    relevantRef.current = opts.relevantTables;
  });

  // Efektin bağımlılıkları yalnızca primitifler olsun: `opts.tables` her render'da
  // yeni bir dizi referansı olabileceği için tek bir anahtar string'e indiriliyor.
  const tablesKey = opts.tables.join("|");
  const tenantId = opts.tenantId;
  const debounceMs = opts.debounceMs;

  useEffect(() => {
    if (!enabled || !tenantId) return;
    const tables = tablesKey.split("|").filter(Boolean);
    const channelName = `es-rt:${tenantId}:${tables.join(",")}`;
    let cancelled = false;
    let supabase: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    // Her router.refresh() sayfanın TÜM sunucu sorgularını yeniden koşturur.
    // Sekme arka plandayken tetiklenmez: "bekliyor" işaretlenir, görünür olunca yenilenir.
    let pending = false;
    const schedule = () => {
      // Bekleyen bir yenileme zaten var: olayı birleştir (yeniden kurma).
      if (timer.current) return;
      const delay = computeRefreshDelay(now(), lastRefreshAt.current, debounceMs ?? 400);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (document.visibilityState === "hidden") {
          pending = true;
          return;
        }
        lastRefreshAt.current = now();
        router.refresh();
      }, delay);
    };
    const bump = (table: string) => {
      const relevant = relevantRef.current?.(pathRef.current ?? "");
      if (relevant && !relevant.includes(table)) return;
      if (document.visibilityState === "hidden") {
        pending = true;
        return;
      }
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pending) return;
      pending = false;
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);

    // supabase-js ilk boyamayı bloklamasın: istemci boşta/sonra ayrı parça olarak yüklenir.
    const cancelIdle = runWhenIdle(() => void import("@/lib/supabase/client").then(({ createClient }) => {
      if (cancelled) return;
      supabase = createClient();
      let ch = supabase.channel(channelName);
      for (const table of tables) {
        ch = ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
          () => bump(table),
        );
      }
      ch.subscribe();
      channel = ch;
    }));

    return () => {
      cancelled = true;
      cancelIdle();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [enabled, tenantId, tablesKey, debounceMs, router]);
}
