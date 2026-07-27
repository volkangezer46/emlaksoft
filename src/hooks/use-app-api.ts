"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CacheEntry<T> = { data: T; ts: number; tenantId: string };

const memory = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const LS_PREFIX = "es_api:v1:";
const DEFAULT_TTL = 45_000;

function cacheKey(tenantId: string, url: string) {
  return `${tenantId}::${url}`;
}

function readLS<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeLS<T>(key: string, entry: CacheEntry<T>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}

export function invalidateAppApi(tenantId: string, ...urls: string[]) {
  for (const url of urls) {
    const key = cacheKey(tenantId, url);
    memory.delete(key);
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* */
    }
  }
  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel("emlaksoft-api");
    bc.postMessage({ type: "invalidate", tenantId, urls });
    bc.close();
  }
}

// `_ttl` bilinçli olarak okunmuyor: prefetch yalnızca cache'i doldurur, tazelik
// kontrolünü çağıran useAppApi yapar. Parametre çağrı yerleriyle uyum için duruyor.
export async function prefetchAppApi(tenantId: string, url: string, _ttl = DEFAULT_TTL) {
  const key = cacheKey(tenantId, url);
  if (memory.has(key)) return;
  if (inflight.has(key)) return inflight.get(key);
  const p = fetch(url, { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const entry = { data, ts: Date.now(), tenantId };
      memory.set(key, entry);
      writeLS(key, entry);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function useAppApi<T>(
  tenantId: string | null | undefined,
  url: string | null,
  opts?: { ttl?: number; enabled?: boolean },
) {
  const ttl = opts?.ttl ?? DEFAULT_TTL;
  const enabled = opts?.enabled !== false && Boolean(tenantId && url);
  const key = tenantId && url ? cacheKey(tenantId, url) : null;

  // İlk state YALNIZ bellek cache'inden beslenir. localStorage burada okunursa
  // tam sayfa yüklemede SSR "yükleniyor…" ile istemcinin ilk render'ı uyuşmaz
  // (hidrasyon hatası). LS okuması hidrasyon sonrası effect'te yapılır; bellek
  // cache'i istemci içi geçişlerde ani boyamayı korur.
  const cached = key ? ((memory.get(key) as CacheEntry<T> | undefined) ?? null) : null;
  const [data, setData] = useState<T | null>(cached?.data ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!tenantId || !url || !key) return;
    if (inflight.has(key)) {
      try {
        const d = (await inflight.get(key)) as T;
        if (mounted.current) {
          setData(d);
          setLoading(false);
        }
      } catch {
        /* */
      }
      return;
    }
    setLoading(true);
    const p = fetch(url, { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<T>;
      })
      .then((d) => {
        const entry = { data: d, ts: Date.now(), tenantId };
        memory.set(key, entry);
        writeLS(key, entry);
        if (mounted.current) {
          setData(d);
          setError(null);
          setLoading(false);
        }
        return d;
      })
      .catch((e: Error) => {
        if (mounted.current) {
          setError(e.message);
          setLoading(false);
        }
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }, [tenantId, url, key]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled || !key || !tenantId) return;

    const mem = memory.get(key) as CacheEntry<T> | undefined;
    const ls = mem ?? readLS<T>(key);
    if (ls && ls.tenantId === tenantId) {
      // Bilinçli istisna: bellek/localStorage cache'inden anında boyama.
      // Ertelemek panel geçişlerinde boş kare (flash) doğurur — bu hook
      // tam olarak onu engellemek için var. Kural başka her yerde hata
      // seviyesinde açık.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cache'ten senkron ilk boyama
      setData(ls.data);
      setLoading(false);
      if (Date.now() - ls.ts < ttl) return;
    }

    void refresh();

    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("emlaksoft-api") : null;
    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; tenantId?: string; urls?: string[] };
      if (msg?.type === "invalidate" && msg.tenantId === tenantId && msg.urls?.some((u) => u === url)) {
        void refresh();
      }
    };
    bc?.addEventListener("message", onMsg);
    return () => {
      mounted.current = false;
      bc?.removeEventListener("message", onMsg);
      bc?.close();
    };
  }, [enabled, key, tenantId, url, ttl, refresh]);

  return { data, loading, error, refresh };
}
