import { useCallback, useEffect, useState } from "react";

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL = 20_000; // 20 saniye

/**
 * HGDekor-style useApi hook genişletmesi
 * - Client-side cache
 * - Auto-refresh on focus
 * - Error handling
 * - Loading states
 */
export function useApi<T>(
  url: string,
  options?: {
    refreshInterval?: number;
    cacheKey?: string;
    enabled?: boolean;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cacheKey = options?.cacheKey ?? url;
  const enabled = options?.enabled !== false;

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    // Cache check
    const cached = cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;

      cache.set(cacheKey, { data: json, timestamp: Date.now() });
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [url, cacheKey, enabled]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh interval
  useEffect(() => {
    if (!options?.refreshInterval) return;
    const interval = setInterval(fetchData, options.refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData, options?.refreshInterval]);

  // Refresh on window focus
  useEffect(() => {
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData]);

  return {
    data,
    error,
    loading,
    refetch: fetchData,
  };
}

/**
 * Prefetch API endpoint
 */
export async function prefetchApi(url: string, cacheKey?: string) {
  const key = cacheKey ?? url;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      cache.set(key, { data, timestamp: Date.now() });
    }
  } catch {
    // Silent fail for prefetch
  }
}

/**
 * Clear cache
 */
export function clearApiCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
