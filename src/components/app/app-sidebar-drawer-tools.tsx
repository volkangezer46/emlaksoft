"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPalette } from "@/lib/palette-events";
import { applyTheme, readThemePref, subscribeTheme, writeThemePref, type ThemePref } from "@/lib/theme";

const THEME_OPTS: { pref: ThemePref; label: string; icon: LucideIcon }[] = [
  { pref: "system", label: "Sistem", icon: Monitor },
  { pref: "light", label: "Açık", icon: Sun },
  { pref: "dark", label: "Koyu", icon: Moon },
];

/**
 * Mobil çekmecenin üst araçları (telefon/tablet): arama (komut paletini açar, Ctrl K ile aynı) ve tema seçimi
 * (Sistem · Açık · Koyu). Masaüstünde üst çubuktaki arama ve "Görünüm" düğmesi aynı işi yapar; burada çizilmez.
 */
export function DrawerTools({ onDone }: { onDone: () => void }) {
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
