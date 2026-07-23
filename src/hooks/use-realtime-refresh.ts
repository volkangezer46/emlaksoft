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

  useEffect(() => {
    if (!enabled || !opts.tenantId) return;
    const supabase = createClient();
    const channelName = `es-rt:${opts.tenantId}:${opts.tables.join(",")}`;

    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), opts.debounceMs ?? 400);
    };

    let channel = supabase.channel(channelName);
    for (const table of opts.tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `tenant_id=eq.${opts.tenantId}` },
        () => bump(),
      );
    }
    channel.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [enabled, opts.tenantId, opts.tables.join("|"), opts.debounceMs, router]);
}
