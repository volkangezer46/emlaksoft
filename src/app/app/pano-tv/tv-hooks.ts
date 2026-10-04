"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { now } from "@/lib/clock";
import { subscribeToInserts } from "@/lib/realtime";
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
/* Canlı veri: realtime INSERT + 45 sn yedek yoklama (router.refresh YOK)      */
/* -------------------------------------------------------------------------- */

export type TvStatus = "loading" | "ok" | "offline" | "session" | "forbidden";

const POLL_MS = 45_000;
const RT_DEBOUNCE_MS = 1_500;
const RT_TABLES = ["customers", "appointments", "offers", "properties", "commissions", "tasks"] as const;

export function useTvData(tenantId: string, revenueRequested: boolean) {
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
      const res = await fetch(`/api/app/tv-data${revenueRef.current ? "?gelir=1" : ""}`, {
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
  }, []);

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
    const poll = setInterval(() => void load(), POLL_MS);
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
  }, [load]);

  // Realtime: tenant filtreli INSERT'ler → debounce'lu anında tazeleme (supabase-js tembel yüklenir)
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), RT_DEBOUNCE_MS);
    };
    const offs = RT_TABLES.map((table) =>
      subscribeToInserts({ channel: `es-tv:${tenantId}:${table}`, table, filter: `tenant_id=eq.${tenantId}`, onInsert: bump }),
    );
    return () => {
      if (debounce) clearTimeout(debounce);
      offs.forEach((off) => off());
    };
  }, [tenantId, load]);

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
