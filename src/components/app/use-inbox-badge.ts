"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { runWhenIdle } from "@/lib/idle";
import { now } from "@/lib/clock";
import { INBOX_BADGE_TTL_MS, INBOX_ITEM_HREF, inboxNavBadge } from "@/lib/inbox-badge";
import type { NavBadge } from "@/lib/nav-badges";

type BadgeState = { count: number; href: string } | null;

/* Sekme içi tek kopya: masaüstü kenar çubuğu, çekmece ve alt çubuk aynı değeri paylaşır. */
let cached: { at: number; value: BadgeState } | null = null;
let inflight: Promise<BadgeState> | null = null;
const listeners = new Set<(v: BadgeState) => void>();

function fetchBadge(): Promise<BadgeState> {
  inflight ??= import("@/app/actions/inbox-badge")
    .then((m) => m.getInboxWaitingBadge())
    .catch(() => null)
    .then((value) => {
      cached = { at: now(), value };
      inflight = null;
      listeners.forEach((cb) => cb(value));
      return value;
    });
  return inflight;
}

/**
 * Gelen kutusu "Yanıt bekliyor" rozeti (COM-01). Kabuk akışı ve TTFB'yi etkilemez: sayı boşta, sunucu eylemiyle gelir;
 * gezintide en çok dakikada bir, gelen kutusundan çıkınca (kapatılan konuşmalar düşsün) ve sekme görünür olunca tazelenir.
 * `enabled` false ise (menüde gelen kutusu yok: yetki/kapalı modül) hiç sorulmaz.
 */
export function useInboxBadge(enabled: boolean): NavBadge | null {
  const pathname = usePathname();
  const [value, setValue] = useState<BadgeState>(() => cached?.value ?? null);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const path = pathname ?? "";
    // Gelen kutusundan çıkıldı: orada kapatılan/yanıtlanan konuşmalar rozetten hemen düşsün.
    const leftInbox = (prevPath.current ?? "").startsWith(INBOX_ITEM_HREF) && !path.startsWith(INBOX_ITEM_HREF);
    prevPath.current = path;
    const stale = !cached || now() - cached.at > INBOX_BADGE_TTL_MS;
    if (!stale && !leftInbox) return;
    return runWhenIdle(() => void fetchBadge(), { timeoutMs: 2_000 });
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!cached || now() - cached.at > INBOX_BADGE_TTL_MS)) void fetchBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled]);

  return enabled ? inboxNavBadge(value) : null;
}
