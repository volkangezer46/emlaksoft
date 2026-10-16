"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { now } from "@/lib/clock";
import { subscribeTopic, tenantTopic } from "@/lib/realtime";
import { parseTenantChange } from "@/lib/realtime-throttle";
import type { TvData } from "@/lib/tv/tv-data";
import { msUntilTrHour, reconcileIndex, stepIndex, type PlannedScene, type TvSceneId } from "@/lib/tv/tv-logic";

/* -------------------------------------------------------------------------- */
/* Canlı veri: ofis konusu (Broadcast) + 60 sn yedek yoklama (router.refresh YOK) */
/* -------------------------------------------------------------------------- */

export type TvStatus = "loading" | "ok" | "offline" | "session" | "forbidden";

const POLL_MS = 60_000;
const RT_DEBOUNCE_MS = 400;
const RT_MIN_GAP_MS = 5_000;
const RT_TABLES = ["customers", "customer_demands", "appointments", "offers", "properties", "commissions", "tasks", "deals", "calls"] as const;

export type TvDataSource = {
  /** Veri ucu: oturumlu pano `/api/app/tv-data`, eşleşmiş TV cihazı `/api/tv/data` (OA6). */
  url: string;
  /** Ofis konusu realtime aboneliği (yalnız oturumlu panoda; cihazda anon realtime yok). */
  realtime: boolean;
  /** Yedek yoklama aralığı (ms). */
  pollMs: number;
};

export const SESSION_TV_SOURCE: TvDataSource = { url: "/api/app/tv-data", realtime: true, pollMs: POLL_MS };
export const DEVICE_TV_SOURCE: TvDataSource = { url: "/api/tv/data", realtime: false, pollMs: 20_000 };

export function useTvData(tenantId: string, source: TvDataSource = SESSION_TV_SOURCE) {
  const [data, setData] = useState<TvData | null>(null);
  const [status, setStatus] = useState<TvStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState(0);
  const inflight = useRef<AbortController | null>(null);
  const retry = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const res = await fetch(source.url, {
        cache: "no-store",
        credentials: "same-origin",
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) return void setStatus("session");
      if (res.status === 403) return void setStatus("forbidden");
      if (!res.ok) throw new Error(`tv-data ${res.status}`);
      const json = (await res.json()) as TvData;
      retry.current = 0;
      setData(json);
      setStatus("ok");
      setUpdatedAt(now());
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setStatus("offline");
      // Otomatik yeniden bağlanma: 5 sn → 10 → 20 → 40 → en çok 60 sn
      retry.current += 1;
      const wait = Math.min(60_000, 5_000 * 2 ** (retry.current - 1));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void loadRef.current(), wait);
    }
  }, [source.url]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // İlk yükleme
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  // Yedek yoklama + sekme görünür olunca / ağ dönünce tazele
  useEffect(() => {
    const poll = setInterval(() => void load(), source.pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onOnline = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, [load, source.pollMs]);

  // Realtime (SK2): ofis konusu (deyim düzeyinde Broadcast; sayfadaki kanal layout'la paylaşılır). Panonun tablolarına
  // ekleme/güncelleme gelince JSON ucu yeniden okunur: ilk olay RT_DEBOUNCE_MS sonra, seri olaylar en sık RT_MIN_GAP_MS'de
  // bir (sürekli akış yoklamayı sonsuza dek ertelemesin). Kopup yeniden katılınca tek okuma.
  useEffect(() => {
    if (!source.realtime) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const bump = () => {
      if (timer) return;
      const wait = Math.max(RT_DEBOUNCE_MS, last + RT_MIN_GAP_MS - now());
      timer = setTimeout(() => {
        timer = null;
        last = now();
        void load();
      }, wait);
    };
    const tables = new Set<string>(RT_TABLES);
    const off = subscribeTopic(tenantTopic(tenantId), {
      on: {
        change: (payload) => {
          const evt = parseTenantChange(payload);
          if (evt && tables.has(evt.t) && evt.op !== "DELETE") bump();
        },
      },
      onStatus: (s) => {
        if (s.rejoin) bump();
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [tenantId, load, source.realtime]);

  return { data, status, updatedAt, reload: load };
}

/* -------------------------------------------------------------------------- */
/* Küçük yardımcılar                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Sahne rotasyonu: her sahne kendi süresi kadar kalır; duraklatınca KALAN süre saklanır ve devamda oradan sürer (CSS
 * ilerleme çubuğu da `animation-play-state` ile aynı anda durur). Plan değişince (veri/ayar) aynı sahnede kalınır.
 * `cycle` her sahne başlangıcında artar: ilerleme çubuğu ve giriş animasyonu bununla yeniden başlar.
 */
export function useSceneRotation(plan: readonly PlannedScene[], paused: boolean) {
  const [state, setState] = useState<{ index: number; id: TvSceneId | null; cycle: number }>({ index: 0, id: null, cycle: 0 });
  const index = reconcileIndex(state.id, state.index, plan);
  const current = plan[index] ?? null;
  // Duraklatmada kalan süre, hangi sahne turuna aitse onunla saklanır (başka tura taşınmaz).
  const remaining = useRef<{ cycle: number; left: number } | null>(null);

  const go = useCallback(
    (dir: 1 | -1) => {
      setState((s) => {
        const i = stepIndex(reconcileIndex(s.id, s.index, plan), plan.length, dir);
        return { index: i, id: plan[i]?.id ?? null, cycle: s.cycle + 1 };
      });
    },
    [plan],
  );

  const ms = current?.ms ?? 0;
  const cycle = state.cycle;
  useEffect(() => {
    if (paused || !ms || plan.length < 2) return;
    const saved = remaining.current;
    const wait = saved && saved.cycle === cycle ? saved.left : ms;
    const started = now();
    const t = setTimeout(() => go(1), wait);
    return () => {
      clearTimeout(t);
      remaining.current = { cycle, left: Math.max(400, wait - (now() - started)) };
    };
  }, [paused, ms, cycle, plan.length, go]);

  return { index, current, cycle: state.cycle, next: () => go(1), prev: () => go(-1) };
}

/** Her gün İstanbul 04:00'te tek yeniden yükleme (uzun açık kalan kiosk: bellek + yeni sürüm). */
export function useDailyReload(hour = 4) {
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), msUntilTrHour(now(), hour));
    return () => clearTimeout(t);
  }, [hour]);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** `intervalMs`'de bir güncellenen epoch ms (0 = henüz hidrate olmadı). Saat şeridi 1 sn, sahneler 30 sn kullanır. */
export function useClock(intervalMs = 1000): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const tick = () => setMs(now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return ms;
}

/** Ekran uyumasın (destekleniyorsa); desteklenmiyorsa/izin yoksa sessizce atlanır. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    type Sentinel = { release: () => Promise<void> };
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
        if (!wl || document.visibilityState !== "visible") return;
        const s = await wl.request("screen");
        if (cancelled) void s.release().catch(() => undefined);
        else sentinel = s;
      } catch {
        /* desteklenmiyor / reddedildi: sessizce geç */
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
