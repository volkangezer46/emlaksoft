"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    const supabase = createClient();
    const channelName = `es-rt:${tenantId}:${tables.join(",")}`;

    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), debounceMs ?? 400);
    };

    let channel = supabase.channel(channelName);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
        () => bump(),
      );
    }
    channel.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [enabled, tenantId, tablesKey, debounceMs, router]);
}
