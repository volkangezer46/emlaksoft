"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { formatTrTime, now } from "@/lib/clock";
import { ageText, FRESHNESS_LABEL, freshnessLevel, type FreshnessLevel } from "@/lib/ui/freshness";
import { getRealtimeStatus, getRealtimeStatusSince, subscribeRealtimeStatus, type RealtimeStatus } from "@/lib/realtime-status";

const TONE: Record<FreshnessLevel, string> = {
  taze: "pm-t-success",
  guncel: "pm-t-brand",
  bayat: "pm-t-warn",
};

/** Damga bu aralıkla yaşlanır (açık sayfada "Taze" sonsuza dek kalmasın; B009). */
export const FRESHNESS_TICK_MS = 30_000;
/** Kanal bu kadar süredir bağlanamıyorsa "Canlı bağlantı yok" (ilk katılımın olağan ~1 sn'si uyarı sayılmaz). */
export const LIVE_GRACE_MS = 8_000;

function toMs(value: string | number | Date): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

/** Canlı kanal kopuk mu? Kopuk (hata/zaman aşımı) hemen; "bağlanıyor" ancak tolerans süresini aşınca. */
export function isLiveDown(status: RealtimeStatus, since: number, nowMs: number): boolean {
  if (status === "offline") return true;
  return status === "connecting" && nowMs - since >= LIVE_GRACE_MS;
}

/**
 * DataFreshness — "Son güncelleme 14:32 · Taze" damgası (istemci adacığı; B009).
 * `asOf` verinin kendi zaman damgasıdır (ör. cron kalp atışı, sorgu anı); verilmezse sayfanın çizildiği an.
 * Açık sayfada 30 sn'de bir yaşlanır (Taze → Güncel → Bayat). Ofisin canlı veri kanalı kopuksa (realtime durum
 * deposu: SUBSCRIBED değil) "Canlı bağlantı yok" yazar; bu sayfada canlı kanal yoksa (ör. /admin) durum gösterilmez.
 * Renk tek başına anlam taşımaz: metin her zaman var.
 */
export function DataFreshness({ asOf, label = "Son güncelleme", className }: { asOf?: string | number | Date | null; label?: string; className?: string }) {
  // asOf yoksa çizim anı. Sunucu ile istemci saati ilk karede ayrışabilir: metin istemcide oturur (hidrasyon uyarısı bastırılır).
  const [renderedAt] = useState(() => now());
  const at = asOf != null ? toMs(asOf) : renderedAt;
  const [clock, setClock] = useState(() => now());
  const status = useSyncExternalStore<RealtimeStatus>(subscribeRealtimeStatus, getRealtimeStatus, () => "idle");
  const since = useSyncExternalStore(subscribeRealtimeStatus, getRealtimeStatusSince, () => 0);

  useEffect(() => {
    const id = window.setInterval(() => setClock(now()), FRESHNESS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // "Bağlanıyor" tolerans süresini aşarsa uyarı görünsün diye tek ek tik; durum değişince saat de güncellenir.
  useEffect(() => {
    const id = window.setTimeout(() => setClock(now()), status === "connecting" ? LIVE_GRACE_MS + 50 : 0);
    return () => window.clearTimeout(id);
  }, [status]);

  const age = Math.max(0, clock - at);
  const level = freshnessLevel(age);
  const liveDown = isLiveDown(status, since, clock);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-text-muted tabular-nums", liveDown ? "pm-t-warn" : TONE[level], className)}
      title={`${label} ${formatTrTime(at)} · ${ageText(age)}${liveDown ? " · canlı güncelleme kanalı bağlı değil" : ""}`}
      suppressHydrationWarning
    >
      <span className="pm-dot" aria-hidden="true" />
      <span suppressHydrationWarning>
        {label} {formatTrTime(at)}
      </span>
      <span className="font-semibold" style={{ color: "var(--t-text, currentColor)" }} suppressHydrationWarning>
        · {liveDown ? "Canlı bağlantı yok" : FRESHNESS_LABEL[level]}
      </span>
    </span>
  );
}
