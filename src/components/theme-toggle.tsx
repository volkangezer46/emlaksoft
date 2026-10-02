"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { AppearancePanel } from "@/components/appearance-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readThemePref, subscribeTheme, type ThemePref } from "@/lib/theme";

const ICONS: Record<ThemePref, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/** Üst çubuktaki "Görünüm" düğmesi: tema modu + vurgu rengi paneli açar. */
export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  const Current = ICONS[pref] ?? Palette;

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Görünüm ve tema ayarları"
        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition-colors hover:text-text"
      >
        <Current className="h-4 w-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Görünüm">
        <AppearancePanel />
      </PopoverContent>
    </Popover>
  );
}
