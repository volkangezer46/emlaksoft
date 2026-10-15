"use client";

import { startTransition, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { ensureRealtimeAuth } from "@/lib/realtime";
import { computeRefreshDelay } from "@/lib/realtime-throttle";
import { noteClientCacheRefreshed } from "@/lib/client-cache-state";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * ADMİN CANLI VERİ (B006). Personel kiracı RLS'ine girmediği için postgres_changes yerine veritabanından Broadcast
 * (`realtime.send`, migration 20261016040000) dinlenir. İki ÖZEL konu:
 *  - `admin:staff`  : support_tickets / support_ticket_messages / invoices / subscriptions / alert_events değişimi
 *  - `staff:<uid>`  : bu personele yazılan platform bildirimi (zil)
 * Yük yalnız kimlik taşır ({t, op, by, ids?}, ≤200 B); veri sayfa tazelemesiyle SUNUCUDAN gelir (yetki/kapsam sunucuda).
 *
 * Tazeleme kuralları (sözleşme):
 *  (a) olay yalnız AÇIK ROTAYI ilgilendiriyorsa (`adminTablesForPath`) `router.refresh()`; ilgisiz rotada hiçbir şey olmaz;
 *  (b) ilk olay ~150 ms'de, seri olaylar en az 2 sn arayla TEK tazelemede birleşir (`computeRefreshDelay`);
 *  (c) sekme arkadayken tazelenmez, görünür olunca tek tazeleme;
 *  (d) bu sekmenin kendi yazımının yankısı (eylem zaten revalidatePath ile tazeledi) `noteAdminLocalWrite` ile yok sayılır;
 *  (e) kanal kopup yeniden katılınca kaçırılan değişiklikler için tek tazeleme + zil yeniden okunur;
 *  (f) zil olayı window olayıyla iletilir (`onAdminNotification`); kanal canlıyken zilin 60 sn yoklaması susar
 *      (`isAdminRealtimeLive`), kopunca yedek olarak geri döner.
 */

export type AdminRtEvent = { t: string; op: string; by: string | null; ids: string[] | null };

export const ADMIN_TOPIC = "admin:staff";
export const staffTopic = (staffId: string) => `staff:${staffId}`;

const KNOWN_TABLES = new Set(["support_tickets", "support_ticket_messages", "invoices", "subscriptions", "alert_events", "platform_notifications"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yükü doğrular; bilinmeyen tablo/biçim null (olay yok sayılır). */
export function parseAdminEvent(raw: unknown): AdminRtEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.t !== "string" || !KNOWN_TABLES.has(p.t)) return null;
  const op = typeof p.op === "string" && ["INSERT", "UPDATE", "DELETE"].includes(p.op) ? p.op : null;
  if (!op) return null;
  const ids = Array.isArray(p.ids) ? p.ids.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)) : null;
  return { t: p.t, op, by: typeof p.by === "string" ? p.by : null, ids: ids && ids.length > 0 ? ids : null };
}

/** Rota öneki → o sayfada tazelenmesi anlamlı tablolar (admin canlı verinin TEK kaynağı). */
export const ADMIN_ROUTE_TABLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/admin/tickets", ["support_tickets", "support_ticket_messages"]],
  ["/admin/billing", ["invoices", "subscriptions"]],
  ["/admin/sistem", ["alert_events"]],
  ["/admin/tenants", ["support_tickets", "invoices", "subscriptions"]],
  ["/admin/bildirimler", ["platform_notifications"]],
];

/** Kontrol paneli (her rolün paneli: platform, muhasebe, destek) tüm özet kaynaklarını gösterir. */
const DASHBOARD_TABLES: readonly string[] = ["support_tickets", "invoices", "subscriptions", "alert_events"];

/** Açık rotada tazelenmesi anlamlı tablolar; bilinmeyen rota (ör. Raporlar, Site) hiçbirini (ağır sayfa boşa çizilmez). */
export function adminTablesForPath(pathname: string | null | undefined): readonly string[] {
  const p = (pathname ?? "").split(/[?#]/, 1)[0]!.replace(/\/+$/, "") || "/";
  if (p === "/admin") return DASHBOARD_TABLES;
  for (const [prefix, tables] of ADMIN_ROUTE_TABLES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return tables;
  }
  return [];
}

// --- Yerel yazım yankısı (d) -------------------------------------------------------------------------------------
const ECHO_WINDOW_MS = 5_000;
const localWrites = new Map<string, number>();

/**
 * Bu sekmenin yaptığı yazım: olay kimlikleri tamamen buradaysa (ve sekme odaktaysa) yankı sayılır. Talep yazımı hem
 * talep hem mesaj tablosunu etkiler (mesaj olayının `ids` alanı bilet kimliğidir).
 */
export function noteAdminLocalWrite(tables: readonly string[], ids: readonly string[]): void {
  const at = now();
  for (const t of tables) for (const id of ids) localWrites.set(`${t}:${id}`, at);
}

export function isLocalEcho(ev: AdminRtEvent, atMs: number): boolean {
  if (!ev.ids) return false;
  for (const [k, at] of localWrites) if (atMs - at > ECHO_WINDOW_MS) localWrites.delete(k);
  const echo = ev.ids.every((id) => {
    const at = localWrites.get(`${ev.t}:${id}`);
    return at !== undefined && atMs - at <= ECHO_WINDOW_MS;
  });
  // İşaret TEK yankıyı yutar: aynı pencerede başka birinin (ör. ofisin yeni mesajı) aynı kayda yazımı yok sayılmaz.
  if (echo) for (const id of ev.ids) localWrites.delete(`${ev.t}:${id}`);
  return echo;
}

// --- Zil köprüsü (f) -----------------------------------------------------------------------------------------------
const NOTIF_EVENT = "es:admin-notification";
const LIVE_EVENT = "es:admin-rt-live";
let live = false;

export function isAdminRealtimeLive(): boolean {
  return live;
}

function setLive(next: boolean) {
  if (live === next) return;
  live = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<boolean>(LIVE_EVENT, { detail: next }));
}

/** Bu personele yeni bildirim (ya da yeniden katılım) → zil kendini yeniden okur. */
export function onAdminNotification(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NOTIF_EVENT, cb);
  return () => window.removeEventListener(NOTIF_EVENT, cb);
}

function emitNotification() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIF_EVENT));
}

type ChannelClient = Pick<SupabaseClient, "channel" | "removeChannel">;

/**
 * Kanal yöneticisi (saf, React'sız; test sahte istemciyle sürer): iki özel kanal açar, olayları ayrıştırır, katılım
 * durumunu bildirir. Kanal başına ilk SUBSCRIBED katılımdır; sonraki her SUBSCRIBED yeniden katılımdır (kopukluk
 * sırasında kaçan olaylar yeniden oynatılmaz → çağıran tek tazeleme yapar). Canlılık (`onLive`) zil kanalına bağlıdır:
 * zilin yedek yoklaması yalnız o kanal katılı değilken çalışır.
 */
export function createAdminChannels(opts: {
  staffId: string;
  onAdmin: (ev: AdminRtEvent) => void;
  onStaff: () => void;
  onAdminRejoin: () => void;
  onStaffRejoin: () => void;
  onLive: (live: boolean) => void;
}) {
  let client: ChannelClient | null = null;
  const channels: RealtimeChannel[] = [];
  const open = (topic: string, handler: (payload: unknown) => void, onRejoin: () => void, trackLive: boolean) => {
    if (!client) return;
    let joined = false;
    const ch = client
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "change" }, (msg: { payload?: unknown }) => handler(msg?.payload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (joined) onRejoin();
          joined = true;
          if (trackLive) opts.onLive(true);
        } else if (trackLive && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
          opts.onLive(false);
        }
      });
    channels.push(ch);
  };
  return {
    attach(next: ChannelClient) {
      client = next;
      open(
        ADMIN_TOPIC,
        (payload) => {
          const ev = parseAdminEvent(payload);
          if (ev) opts.onAdmin(ev);
        },
        opts.onAdminRejoin,
        false,
      );
      open(
        staffTopic(opts.staffId),
        (payload) => {
          if (parseAdminEvent(payload)) opts.onStaff();
        },
        opts.onStaffRejoin,
        true,
      );
    },
    dispose() {
      if (client) for (const ch of channels) void client.removeChannel(ch);
      channels.length = 0;
      client = null;
      opts.onLive(false);
    },
  };
}

/** Admin layout adacığı: kanalları açar, olayları 2 sn'de birleştirip `router.refresh()` yapar, zili uyarır. */
export function useAdminRealtime(staffId: string | null | undefined, debounceMs = 150): void {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastRefreshAt: number | null = null;
    let pending = false;

    const refresh = () => {
      timer = null;
      if (document.visibilityState === "hidden") {
        pending = true;
        return;
      }
      lastRefreshAt = now();
      noteClientCacheRefreshed(`${window.location.pathname}?${window.location.search.replace(/^\?/, "")}`);
      startTransition(() => router.refresh());
    };
    const schedule = () => {
      if (timer) return; // bekleyen tazeleme var: olay birleşir
      timer = setTimeout(refresh, computeRefreshDelay(now(), lastRefreshAt, debounceMs));
    };
    const onAdmin = (ev: AdminRtEvent) => {
      if (!adminTablesForPath(pathRef.current).includes(ev.t)) return;
      if (document.hasFocus() && isLocalEcho(ev, now())) return;
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

    const mgr = createAdminChannels({
      staffId,
      onAdmin,
      onStaff: emitNotification,
      onStaffRejoin: emitNotification,
      onAdminRejoin: () => {
        if (adminTablesForPath(pathRef.current).length === 0) return;
        if (document.visibilityState === "hidden") pending = true;
        else schedule();
      },
      onLive: setLive,
    });

    let onOnline: (() => void) | null = null;
    // supabase-js ilk boyamayı bloklamaz: boşta ayrı parça olarak iner (kabuk görünür olduktan sonra).
    const cancelIdle = runWhenIdle(() => void import("@/lib/supabase/client").then(async ({ createClient }) => {
      if (cancelled) return;
      const supabase = createClient();
      // Jeton katılımdan ÖNCE: özel konu politikası oturum kimliğine bakar (anon katılım reddedilir).
      await ensureRealtimeAuth(supabase);
      if (cancelled) return;
      mgr.attach(supabase);
      onOnline = () => {
        if (!supabase.realtime.isConnected()) supabase.realtime.connect();
      };
      window.addEventListener("online", onOnline);
    }));

    return () => {
      cancelled = true;
      cancelIdle();
      if (onOnline) window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
      mgr.dispose();
    };
  }, [staffId, debounceMs, router]);
}

/** Zil için canlılık aboneliği (yedek yoklama kararı). */
export function onAdminRealtimeLive(cb: (live: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(LIVE_EVENT, h);
  return () => window.removeEventListener(LIVE_EVENT, h);
}
