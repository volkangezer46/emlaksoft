"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { readThemePref, subscribeTheme, type ThemePref } from "@/lib/theme";
import { THEME_ICONS, THEME_TRIGGER_CLASS } from "@/components/theme-toggle";

// Panel gövdesi (renk paleti + mod seçici) popover ilk açılana kadar yüklenmez.
const AppearancePanel = lazy(() => import("@/components/appearance-panel").then((m) => ({ default: m.AppearancePanel })));

/** Radix Popover gövdesi — theme-toggle.tsx tarafından ilk etkileşimde yüklenir, açık gelir. */
export function ThemeTogglePanel({ className = "", initialOpen }: { className?: string; initialOpen?: boolean }) {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  const Current = THEME_ICONS[pref] ?? Palette;
  return (
    <Popover defaultOpen={initialOpen}>
      <PopoverTrigger aria-label="Görünüm ve tema ayarları" className={`${THEME_TRIGGER_CLASS} ${className}`}>
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
