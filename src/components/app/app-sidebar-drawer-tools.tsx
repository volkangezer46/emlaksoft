"use client";

import { Suspense, use, useSyncExternalStore, type KeyboardEvent } from "react";
import { Monitor, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPalette } from "@/lib/palette-events";
import { applyTheme, readThemePref, subscribeTheme, writeThemePref, type ThemePref } from "@/lib/theme";
import { PRESENCE_LABEL, PRESENCE_NOTE_MAX, type OwnPresence } from "@/lib/presence";
import { PRESENCE_ORDER, PresenceDot, usePresenceChoice } from "@/components/ui/console/presence-state";

const THEME_OPTS: { pref: ThemePref; label: string; icon: LucideIcon }[] = [
  { pref: "system", label: "Sistem", icon: Monitor },
  { pref: "light", label: "Açık", icon: Sun },
  { pref: "dark", label: "Koyu", icon: Moon },
];

/**
 * "Durumum" (Ofiste · Görüşmede · Sahada · Mola · Uzakta · Çevrimdışı): kullanıcı menüsündeki seçiciyle AYNI durum mantığı
 * (`usePresenceChoice`); çekmece parçasıyla iner (ilk yük paketine girmez). Gün sonunda sıfırlanır.
 */
function DrawerPresence({ presence }: { presence: Promise<OwnPresence | null> }) {
  const initial = use(presence);
  if (!initial) return null;
  return <DrawerPresenceBody initial={initial} />;
}

function DrawerPresenceBody({ initial }: { initial: OwnPresence }) {
  const { status, note, setNote, error, pending, save } = usePresenceChoice(initial);
  const onNoteKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save(status ?? "office", note);
    }
  };
  return (
    <div className="sb-presence space-y-1.5 rounded-[var(--radius-control)] bg-white/6 p-1.5">
      <p className="flex items-center justify-between gap-2 px-1.5 pt-0.5 text-xs font-semibold text-white/75">
        <span>Durumum</span>
        {status ? <span className="truncate font-normal text-white/55">Gün sonunda sıfırlanır</span> : null}
      </p>
      {/* İki sütun (M5): üç sütunda 360 px'te "Görüşmede", "Çevrimdışı" kırpılıyordu; etiket tam okunur, kırpılmaz. */}
      <div role="radiogroup" aria-label="Durumum" aria-busy={pending} className="grid grid-cols-2 gap-1">
        {PRESENCE_ORDER.map((st) => (
          <Button
            key={st}
            variant="ghost"
            size="sm"
            role="radio"
            aria-checked={status === st}
            onClick={() => save(st, note)}
            className={`min-h-11 min-w-0 justify-start gap-1.5 px-2.5 text-xs font-semibold ${status === st ? "bg-white/18 text-white hover:bg-white/18 hover:text-white" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
          >
            <PresenceDot status={st} className="h-2 w-2" />
            <span className="min-w-0 whitespace-nowrap">{PRESENCE_LABEL[st]}</span>
          </Button>
        ))}
      </div>
      <label className="sr-only" htmlFor="drawer-presence-note">Kısa not</label>
      <input
        id="drawer-presence-note"
        type="text"
        value={note}
        maxLength={PRESENCE_NOTE_MAX}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={onNoteKey}
        onBlur={() => (status && note !== (initial.note ?? "") ? save(status, note) : undefined)}
        placeholder="Kısa not (ör. 15:00'e kadar Kadıköy)"
        enterKeyHint="done"
        className="h-11 w-full rounded-[var(--radius-control)] border border-white/12 bg-white/6 px-2.5 text-sm text-white placeholder:text-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold-300)]"
      />
      {error ? (
        <p role="alert" className="truncate px-1 text-xs text-danger-300" title={error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Mobil çekmecenin üst araçları (telefon/tablet): arama (komut paletini açar, Ctrl K ile aynı), "Durumum" seçici ve tema
 * seçimi (Sistem · Açık · Koyu). Masaüstünde üst çubuktaki arama ve kullanıcı menüsü aynı işi yapar; burada çizilmez.
 */
export function DrawerTools({ onDone, presence = null }: { onDone: () => void; presence?: Promise<OwnPresence | null> | null }) {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  return (
    <div className="sb-label mx-3 mb-2 space-y-2">
      <Button
        variant="ghost"
        icon={Search}
        onClick={() => {
          onDone();
          openPalette();
        }}
        className="min-h-11 w-full justify-start gap-3 border border-white/12 bg-white/6 px-3 text-sm font-normal text-white/75 hover:bg-white/10 hover:text-white"
      >
        <span className="min-w-0 flex-1 truncate text-left">Müşteri, ilan, görev ara…</span>
      </Button>
      {presence ? (
        <Suspense fallback={null}>
          <DrawerPresence presence={presence} />
        </Suspense>
      ) : null}
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-white/6 p-1">
        {THEME_OPTS.map((o) => (
          <Button
            key={o.pref}
            variant="ghost"
            size="sm"
            icon={o.icon}
            role="radio"
            aria-checked={pref === o.pref}
            onClick={() => {
              writeThemePref(o.pref);
              applyTheme();
            }}
            className={`min-h-11 justify-center gap-1.5 px-1 text-xs font-semibold ${pref === o.pref ? "bg-white/18 text-white hover:bg-white/18 hover:text-white" : "text-white/65 hover:bg-white/8 hover:text-white"}`}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
