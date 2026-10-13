"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { noteClientCacheRefreshed } from "@/lib/client-cache-state";
import { computeRefreshDelay, shouldIgnoreRealtimeEvent } from "@/lib/realtime-throttle";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type RealtimePayload = { new?: Record<string, unknown> | null; commit_timestamp?: string | null; eventType?: string };

/** Kanal yöneticisinin ihtiyaç duyduğu en küçük istemci yüzeyi (test sahte istemciyle sürer). */
type ChannelClient = Pick<SupabaseClient, "channel" | "removeChannel">;

/**
 * TEK tablo kanalı yöneticisi (saf, React'sız; test edilir). İstenen tablo kümesi değişince eski kanal kaldırılır,
 * yeni küme için tek `postgres_changes` kanalı açılır; küme boşsa kanal açılmaz. İstemci (supabase-js) boşta
 * yüklendiği için `attach` sonradan gelebilir: o ana kadar istenen küme saklanır, bağlanınca uygulanır.
 * Konu adına sıra eklenir: aynı küme hızla geri gelirse (A→B→A) ayrılmakta olan eski kanal yeniden kullanılmaz.
 */
export function createTableChannelSync(opts: {
  tenantId: string;
  onEvent: (table: string, payload: RealtimePayload) => void;
}) {
  const { tenantId, onEvent } = opts;
  let client: ChannelClient | null = null;
  let channel: RealtimeChannel | null = null;
  let openKey = "";
  let wanted: readonly string[] = [];
  let seq = 0;

  const close = () => {
    if (client && channel) void client.removeChannel(channel);
    channel = null;
    openKey = "";
  };
  const apply = () => {
    if (!client) return;
    const key = wanted.join(",");
    if (key === openKey && (channel !== null || key === "")) return;
    close();
    if (wanted.length === 0) return;
    let ch = client.channel(`es-rt:${tenantId}:${key}:${++seq}`);
    for (const table of wanted) {
      ch = ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
        (payload) => onEvent(table, payload as RealtimePayload),
      );
    }
    ch.subscribe();
    channel = ch;
    openKey = key;
  };

  return {
    attach(next: ChannelClient) {
      client = next;
      apply();
    },
    setTables(tables: readonly string[]) {
      wanted = [...new Set(tables.filter(Boolean))].sort();
      apply();
    },
    dispose() {
      close();
      client = null;
    },
  };
}

/**
 * HGDekor tarzı: ilgili tabloda değişiklik olunca sayfayı yenile.
 * Tenant izolasyonu RLS + filtre ile; channel adı tenant’a kilitli.
 *
 * Abonelik ROTAYA iner: `tablesForPath` verilirse açık rotanın tabloları TEK kanalda dinlenir; rota değişip küme
 * değişince eski kanal kaldırılıp yenisine abone olunur, ilgili tablosu olmayan rotada kanal açılmaz.
 * Fırtına önleme: iki yenileme arası en az 10 sn; bekleyen yenileme varken gelen olaylar birleştirilir.
 */
export function useRealtimeRefresh(opts: {
  tenantId: string | null | undefined;
  /** Sabit tablo kümesi (`tablesForPath` yoksa). */
  tables?: readonly string[];
  /** Açık rotaya göre tablo kümesi; verilirse `tables` yerine bu kullanılır. */
  tablesForPath?: (pathname: string) => readonly string[];
  enabled?: boolean;
  debounceMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAt = useRef<number | null>(null);
  const enabled = opts.enabled !== false && Boolean(opts.tenantId);

  // Efektin bağımlılıkları yalnızca primitifler olsun: küme her render'da yeni dizi olabileceği için anahtar string'e indirilir.
  const active = opts.tablesForPath ? opts.tablesForPath(pathname ?? "") : (opts.tables ?? []);
  const tablesKey = [...new Set(active)].sort().join("|");
  const tablesRef = useRef(tablesKey);
  const syncRef = useRef<ReturnType<typeof createTableChannelSync> | null>(null);
  const tenantId = opts.tenantId;
  const debounceMs = opts.debounceMs;

  useEffect(() => {
    if (!enabled || !tenantId) return;
    let cancelled = false;

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
    const bump = (_table: string, payload?: RealtimePayload) => {
      // Kendi yazımızın yankısı / son tazelemede zaten görünen değişiklik: mutasyon revalidatePath ile tazeler.
      if (payload && shouldIgnoreRealtimeEvent(payload, selfUserId, lastRefreshAt.current)) return;
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

    const sync = createTableChannelSync({ tenantId, onEvent: bump });
    syncRef.current = sync;
    sync.setTables(tablesRef.current.split("|").filter(Boolean));

    // supabase-js ilk boyamayı bloklamasın: istemci boşta/sonra ayrı parça olarak yüklenir.
    const cancelIdle = runWhenIdle(() => void import("@/lib/supabase/client").then(({ createClient }) => {
      if (cancelled) return;
      const supabase = createClient();
      void supabase.auth.getSession().then(({ data }) => {
        selfUserId = data.session?.user?.id ?? null;
      });
      sync.attach(supabase);
    }));

    return () => {
      cancelled = true;
      cancelIdle();
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      sync.dispose();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [enabled, tenantId, debounceMs, router]);

  // Rota → tablo kümesi: değişince kanal yeniden kurulur (aynı kümede hiçbir şey yapılmaz).
  useEffect(() => {
    tablesRef.current = tablesKey;
    syncRef.current?.setTables(tablesKey.split("|").filter(Boolean));
  }, [tablesKey]);
}
