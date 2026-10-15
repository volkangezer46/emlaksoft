"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { now } from "@/lib/clock";
import { subscribeTopic, tenantTopic } from "@/lib/realtime";
import { parseTenantChange } from "@/lib/realtime-throttle";
import type { TvData } from "@/lib/tv/tv-data";
import { DEFAULT_TV_SETTINGS, ROTATION_SECONDS, parseTvSettings, type TvSettings } from "@/lib/tv/tv-logic";

/* -------------------------------------------------------------------------- */
/* Ayarlar: cihaz başına localStorage (migration yok)                          */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();

function readRaw(key: string): string {
  const mem = memory.get(key);
  if (mem != null) return mem;
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function useTvSettings(tenantId: string): [TvSettings, (patch: Partial<TvSettings>) => void] {
  const key = `es-tv-settings:${tenantId}`;
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => "",
  );
  const settings = useMemo(() => (raw ? parseTvSettings(raw) : { ...DEFAULT_TV_SETTINGS }), [raw]);
  const update = useCallback(
    (patch: Partial<TvSettings>) => {
      const next = parseTvSettings({ ...parseTvSettings(readRaw(key)), ...patch });
      const text = JSON.stringify(next);
      memory.set(key, text);
      try {
        window.localStorage.setItem(key, text);
      } catch {
        /* depolama kapalı: bellek kopyası sayfa ömrünce yeter */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [settings, update];
}

/* -------------------------------------------------------------------------- */
/* Canlı veri: ofis konusu (Broadcast) + 45 sn yedek yoklama (router.refresh YOK) */
/* -------------------------------------------------------------------------- */

export type TvStatus = "loading" | "ok" | "offline" | "session" | "forbidden";

const POLL_MS = 45_000;
const RT_DEBOUNCE_MS = 400;
const RT_MIN_GAP_MS = 5_000;
const RT_TABLES = ["customers", "appointments", "offers", "properties", "commissions", "tasks", "deals"] as const;

export type TvDataSource = {
  /** Veri ucu: oturumlu pano `/api/app/tv-data`, eşleşmiş TV cihazı `/api/tv/data` (OA6). */
  url: string;
  /** Ofis konusu realtime aboneliği (yalnız oturumlu panoda; cihazda anon realtime yok). */
  realtime: boolean;
  /** Yedek yoklama aralığı (ms). */
  pollMs: number;
};

export const SESSION_TV_SOURCE: TvDataSource = { url: "/api/app/tv-data", realtime: true, pollMs: POLL_MS };
export const DEVICE_TV_SOURCE: TvDataSource = { url: "/api/tv/data", realtime: false, pollMs: 15_000 };

export function useTvData(tenantId: string, revenueRequested: boolean, source: TvDataSource = SESSION_TV_SOURCE) {
  const [data, setData] = useState<TvData | null>(null);
  const [status, setStatus] = useState<TvStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState(0);
  const inflight = useRef<AbortController | null>(null);
  const retry = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revenueRef = useRef(revenueRequested);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    revenueRef.current = revenueRequested;
  }, [revenueRequested]);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    try {
      const res = await fetch(`${source.url}${revenueRef.current && source.realtime ? "?gelir=1" : ""}`, {
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
  }, [source.url, source.realtime]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // İlk yükleme + gelir ayarı değişince hemen tazele
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load, revenueRequested]);

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

/** Rotasyon sayacı: her `seconds` sn'de +1 (duraklatılınca durur; süre değişince sayaç yeniden kurulur). */
export function useRotation(paused: boolean, seconds: number = ROTATION_SECONDS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setTick((t) => t + 1), seconds * 1000);
    return () => clearInterval(id);
  }, [paused, seconds]);
  return tick;
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

export function useSystemDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}

/** Saniyede bir güncellenen epoch ms (0 = henüz hidrate olmadı). */
export function useClock(): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const tick = () => setMs(now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
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
