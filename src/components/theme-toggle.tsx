"use client";

import { Suspense, useSyncExternalStore } from "react";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useDeferredPanel } from "@/hooks/use-deferred-panel";
import { lazyPanel } from "@/lib/lazy-panel";
import { readThemePref, subscribeTheme, type ThemePref } from "@/lib/theme";

export const THEME_ICONS: Record<ThemePref, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/** Düğme sınıfı hafif kabukta ve Radix gövdesinde AYNI (yüklenince düğme sıçramaz). */
export const THEME_TRIGGER_CLASS =
  "focus-ring inline-flex h-11 w-11 items-center justify-center sm:h-10 sm:w-10 rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition-colors hover:text-text";

// Radix Popover gövdesi (+ renk paleti paneli) ilk etkileşime kadar yüklenmez; boşta önceden iner.
const panel = lazyPanel(() => import("@/components/theme-toggle-panel").then((m) => m.ThemeTogglePanel));

/** Üst çubuktaki "Görünüm" düğmesi: tema modu + vurgu rengi paneli açar (hafif kabuk). */
export function ThemeToggle({ className = "" }: { className?: string } = {}) {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  const Current = THEME_ICONS[pref] ?? Palette;
  const { Panel, open, warm } = useDeferredPanel(panel);
  const trigger = (
    <button
      type="button"
      onClick={open}
      onPointerEnter={warm}
      onFocus={warm}
      aria-haspopup="dialog"
      aria-expanded={false}
      aria-label="Görünüm ve tema ayarları"
      className={`${THEME_TRIGGER_CLASS} ${className}`}
    >
      <Current className="h-4 w-4" aria-hidden />
    </button>
  );
  if (!Panel) return trigger;
  return (
    <Suspense fallback={trigger}>
      <Panel className={className} initialOpen />
    </Suspense>
  );
}
