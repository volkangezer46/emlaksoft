"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * HGDekor tarzı: ilgili tabloda değişiklik olunca sayfayı yenile.
 * Tenant izolasyonu RLS + filtre ile; channel adı tenant’a kilitli.
 */
export function useRealtimeRefresh(opts: {
  tenantId: string | null | undefined;
  tables: string[];
  enabled?: boolean;
  debounceMs?: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = opts.enabled !== false && Boolean(opts.tenantId);

  // Efektin bağımlılıkları yalnızca primitifler olsun: `opts.tables` her render'da
  // yeni bir dizi referansı olabileceği için tek bir anahtar string'e indiriliyor
  // ve tablo listesi efekt içinde bu anahtardan çözülüyor. Böylece bağımlılık
  // dizisinde bileşik ifade kalmıyor (statik olarak denetlenebilir) ve gereksiz
  // yeniden abonelik olmuyor.
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
    // Sekme arka plandayken boşuna tetiklenmesin: değişiklik "bekliyor" işaretlenir,
    // sekme görünür olunca tek seferde yenilenir (veri bayatlamaz, sunucu yükü düşer).
    let pending = false;
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        pending = true;
        return;
      }
      timer.current = setTimeout(() => router.refresh(), debounceMs ?? 400);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !pending) return;
      pending = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), debounceMs ?? 400);
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
          () => bump(),
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
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [enabled, tenantId, tablesKey, debounceMs, router]);
}
