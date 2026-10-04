"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readThemePref, subscribeTheme, type ThemePref } from "@/lib/theme";

// Panel gövdesi (renk paleti + mod seçici) popover ilk açılana kadar yüklenmez.
const AppearancePanel = lazy(() => import("@/components/appearance-panel").then((m) => ({ default: m.AppearancePanel })));

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
      {/* 9 vurgu kartı kısa ekranda taşabilir: panel kullanılabilir yüksekliğe sığar, gerekirse kayar. */}
      <PopoverContent align="end" aria-label="Görünüm" className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
        <Suspense fallback={<div className="h-40 w-64" aria-hidden />}>
          <AppearancePanel />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
