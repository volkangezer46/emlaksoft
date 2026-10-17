"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { setMyPresence } from "@/app/actions/presence";
import { isPresenceStatus, PRESENCE_DOT, PRESENCE_LABEL, PRESENCE_NOTE_MAX, type OwnPresence, type PresenceStatus } from "@/lib/presence";

/** Menü sırası (referans): en sık kullanılan önde, Çevrimdışı en sonda. */
const ORDER: readonly PresenceStatus[] = ["office", "meeting", "field", "break", "away", "offline"];

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
 * Kullanıcı menüsündeki DURUM SEÇİCİ (yalnız /app; menü gövdesiyle birlikte ilk etkileşimde yüklenir — ilk yük paketine
 * girmez). Seçim anında işaretlenir (iyimser), sunucuya `setMyPresence` gider; hata olursa eski seçime döner ve kısa not
 * gösterir. Kısa not (≤60) Enter ile kaydedilir; menünün harf-arama tuşları alana sızmaz.
 */
export function PresenceMenuItems({ initial }: { initial: OwnPresence }) {
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

  function onNoteKey(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      save(status ?? "office", note);
    }
  }

  return (
    <>
      <DropdownMenuLabel className="flex items-center justify-between gap-2">
        <span>Durumum</span>
        {status ? <span className="truncate text-xs font-normal normal-case tracking-normal text-text-muted">Gün sonunda sıfırlanır</span> : null}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={status ?? ""}
        onValueChange={(v) => (isPresenceStatus(v) ? save(v, note) : undefined)}
        aria-label="Durumum"
        aria-busy={pending}
        className="grid grid-cols-2 gap-0.5 px-1"
      >
        {ORDER.map((s) => (
          <DropdownMenuRadioItem key={s} value={s} onSelect={(e) => e.preventDefault()} className="min-w-0 gap-2 pl-7 pr-2">
            <PresenceDot status={s} />
            <span className="truncate" title={PRESENCE_LABEL[s]}>{PRESENCE_LABEL[s]}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <div className="px-2 pb-1.5 pt-1">
        <label className="sr-only" htmlFor="presence-note">Kısa not</label>
        <input
          id="presence-note"
          type="text"
          value={note}
          maxLength={PRESENCE_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onNoteKey}
          placeholder="Kısa not (ör. 15:00'e kadar Kadıköy)"
          className="h-9 w-full rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 text-xs text-text placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring,currentColor)]"
          enterKeyHint="done"
        />
        {error ? (
          <p role="alert" className="mt-1 truncate text-xs text-danger-600" title={error}>
            {error}
          </p>
        ) : null}
      </div>
      <DropdownMenuSeparator />
    </>
  );
}
