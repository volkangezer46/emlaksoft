"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { formatTrTime, now } from "@/lib/clock";
import { CLIENT_CACHE_REFRESHED_EVENT, getFetchedAt } from "@/lib/client-cache-state";

/**
 * "Son güncelleme 14:32 · Taze" (v4 üst çubuk tazelik satırı; /app ve /admin ortak): sayfa verisinin istemciye geldiği an
 * (önce göster sonra tazele önbelleği, `client-cache-state`); 2 dakikadan eskiyse "· N dk önce" (tazelemeyi ClientCacheSync
 * kendiliğinden yapar). Saat yalnız istemcide yazılır (sunucuda aynı yükseklikte boş yer tutucu; hidrasyon farkı yok).
 */
const FRESH_MS = 120_000;
const TICK_MS = 30_000;

export function TopbarFreshness() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = `${pathname}?${search}`;
  const [state, setState] = useState<{ at: number; nowMs: number } | null>(null);

  useEffect(() => {
    // Önbellek varış işareti (ClientCacheSync) aynı karede yazılır: bir sonraki görev turunda okunur; sessiz tazeleme
    // bitince (CLIENT_CACHE_REFRESHED_EVENT) saat yenilenir.
    const read = () => {
      const t = now();
      setState({ at: getFetchedAt(key) ?? t, nowMs: t });
    };
    const first = setTimeout(read, 0);
    const tick = setInterval(() => setState((s) => (s ? { ...s, nowMs: now() } : s)), TICK_MS);
    window.addEventListener(CLIENT_CACHE_REFRESHED_EVENT, read);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      window.removeEventListener(CLIENT_CACHE_REFRESHED_EVENT, read);
    };
  }, [key]);

  if (!state) return <span className="block h-4" aria-hidden />;
  const age = Math.max(0, state.nowMs - state.at);
  const fresh = age < FRESH_MS;
  const ago = fresh ? "Taze" : `${Math.max(2, Math.round(age / 60_000))} dk önce`;
  return (
    <p
      title={fresh ? "Veriler güncel" : "Sayfa arka planda kendiliğinden tazelenir"}
      className="flex h-4 min-w-0 items-center gap-1.5 text-xs leading-4 text-text-muted"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${fresh ? "bg-mint-500 shadow-[0_0_0_3px_color-mix(in_srgb,var(--mint-500)_18%,transparent)]" : "bg-amber-500"}`} aria-hidden />
      {/* Etiket gövde yazı tipinde, yalnız saat rakam yazı tipinde: sıkı harf aralıklı `.num` boşluğu yutuyordu ("Son güncelleme01:45"). */}
      <span className="min-w-0 truncate">
        Son güncelleme <span className="num">{formatTrTime(state.at)}</span> · <span className={fresh ? "font-semibold text-mint-600" : "font-semibold text-text-muted"}>{ago}</span>
      </span>
    </p>
  );
}

