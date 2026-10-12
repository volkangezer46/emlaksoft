"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { noteClientCacheRefreshed } from "@/lib/client-cache-state";
import { computeRefreshDelay, shouldIgnoreRealtimeEvent } from "@/lib/realtime-throttle";
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
  /** Ayrı kanalda dinlenen ek tablolar (publication'da olmayan tablo yalnız bu kanalı sessiz bırakır). */
  extraTables?: string[];
  /** Üçüncü ayrı kanal (sonradan yayına eklenen tablolar). */
  moreTables?: string[];
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
  const extraKey = (opts.extraTables ?? []).join("|");
  const moreKey = (opts.moreTables ?? []).join("|");
  const tenantId = opts.tenantId;
  const debounceMs = opts.debounceMs;

  useEffect(() => {
    if (!enabled || !tenantId) return;
    const tables = tablesKey.split("|").filter(Boolean);
    const extra = extraKey.split("|").filter(Boolean);
    const more = moreKey.split("|").filter(Boolean);
    let cancelled = false;
    let supabase: SupabaseClient | null = null;
    const channels: RealtimeChannel[] = [];

    // Her router.refresh() sayfanın TÜM sunucu sorgularını yeniden koşturur.
    // Sekme arka plandayken tetiklenmez: "bekliyor" işaretlenir, görünür olunca yenilenir.
    let pending = false;
    let selfUserId: string | null = null;
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
        // Tazeleme TÜM istemci segment önbelleğini geçersiz kılar: tazelik kaydı yalnız bu adres için yeni.
        noteClientCacheRefreshed(`${window.location.pathname}?${window.location.search.replace(/^\?/, "")}`);
        router.refresh();
      }, delay);
    };
    const bump = (table: string, payload?: { new?: Record<string, unknown> | null; commit_timestamp?: string | null; eventType?: string }) => {
      // Kendi yazımızın yankısı / son tazelemede zaten görünen değişiklik: mutasyon revalidatePath ile tazeler.
      if (payload && shouldIgnoreRealtimeEvent(payload, selfUserId, lastRefreshAt.current)) return;
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
      void supabase.auth.getSession().then(({ data }) => {
        selfUserId = data.session?.user?.id ?? null;
      });
      const open = (name: string, list: string[]) => {
        if (!supabase || list.length === 0) return;
        let ch = supabase.channel(name);
        for (const table of list) {
          ch = ch.on(
            "postgres_changes",
            { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
            (payload) => bump(table, payload as { new?: Record<string, unknown> | null; commit_timestamp?: string | null; eventType?: string }),
          );
        }
        ch.subscribe();
        channels.push(ch);
      };
      open(`es-rt:${tenantId}:${tables.join(",")}`, tables);
      open(`es-rt-x:${tenantId}:${extra.join(",")}`, extra);
      open(`es-rt-m:${tenantId}:${more.join(",")}`, more);
    }));

    return () => {
      cancelled = true;
      cancelIdle();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const client = supabase;
      if (client) for (const ch of channels) void client.removeChannel(ch);
    };
  }, [enabled, tenantId, tablesKey, extraKey, moreKey, debounceMs, router]);
}
