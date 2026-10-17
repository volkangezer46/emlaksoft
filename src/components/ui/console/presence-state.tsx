"use client";

import { useState, useTransition } from "react";
import { setMyPresence } from "@/app/actions/presence";
import { PRESENCE_DOT, type OwnPresence, type PresenceStatus } from "@/lib/presence";

/** Seçici sırası (referans): en sık kullanılan önde, Çevrimdışı en sonda. Kullanıcı menüsü ve mobil çekmece ortak. */
export const PRESENCE_ORDER: readonly PresenceStatus[] = ["office", "meeting", "field", "break", "away", "offline"];

export function PresenceDot({ status, className = "" }: { status: PresenceStatus; className?: string }) {
  const off = status === "offline";
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
      style={off ? { boxShadow: `inset 0 0 0 2px ${PRESENCE_DOT.offline}` } : { background: PRESENCE_DOT[status], boxShadow: `0 0 0 3px color-mix(in srgb, ${PRESENCE_DOT[status]} 22%, transparent)` }}
    />
  );
}

/**
 * "Durumum" seçiminin TEK durum mantığı (kullanıcı menüsü + mobil çekmece): seçim anında işaretlenir (iyimser), sunucuya
 * `setMyPresence` gider; hata olursa eski seçime döner ve kısa not gösterilir.
 */
export function usePresenceChoice(initial: OwnPresence) {
  const [status, setStatus] = useState<PresenceStatus | null>(initial.status);
  const [note, setNote] = useState(initial.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(next: PresenceStatus, nextNote: string) {
    const prev = status;
    setStatus(next);
    setError(null);
    start(async () => {
      const res = await setMyPresence(next, nextNote);
      if (!res.ok) {
        setStatus(prev);
        setError(res.error);
      }
      // Başarıda eylemin revalidatePath'i avatar noktasını ve ana sayfa listesini aynı yanıtta tazeler.
    });
  }
  return { status, note, setNote, error, pending, save };
}
