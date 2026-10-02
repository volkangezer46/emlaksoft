"use client";

import { useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  ACCENTS,
  readAccentPref,
  readThemePref,
  subscribeTheme,
  writeAccentPref,
  writeThemePref,
  type AccentPref,
  type ThemePref,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Sistem", icon: Monitor },
  { value: "light", label: "Açık", icon: Sun },
  { value: "dark", label: "Koyu", icon: Moon },
];

function readResolvedDark(): boolean {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/**
 * "Görünüm" paneli: mod (Sistem/Açık/Koyu) + vurgu rengi örnek kartları +
 * canlı önizleme. Seçim anında uygulanır (ThemeController olayı dinler) ve
 * localStorage + çerezde kalıcıdır. Tek başına bir sayfaya da gömülebilir
 * (ör. Ayarlar > Profil): kendi kendine yeten, bağımlılığı yalnız lib/theme.
 */
export function AppearancePanel({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  const accent = useSyncExternalStore(subscribeTheme, readAccentPref, () => "ocean" as AccentPref);
  const dark = useSyncExternalStore(subscribeTheme, readResolvedDark, () => false);

  return (
    <div className={cn("w-[min(22rem,calc(100vw-2rem))] space-y-4 p-4", className)}>
      <section aria-labelledby="gorunum-mod">
        <h3 id="gorunum-mod" className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Tema
        </h3>
        <div role="radiogroup" aria-labelledby="gorunum-mod" className="grid grid-cols-3 gap-1 rounded-[var(--radius-control)] bg-surface-sunken p-1">
          {MODES.map(({ value, label, icon: Icon }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => writeThemePref(value)}
                className={cn(
                  "focus-ring inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-chip)] text-sm font-medium transition-colors",
                  active ? "bg-surface text-text shadow-[var(--elev-1)]" : "text-text-muted hover:text-text",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="gorunum-vurgu">
        <h3 id="gorunum-vurgu" className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Vurgu rengi
        </h3>
        <div role="radiogroup" aria-labelledby="gorunum-vurgu" className="grid grid-cols-2 gap-2">
          {ACCENTS.map((a) => {
            const active = accent === a.value;
            const fill = dark ? a.fillDark : a.fill;
            const text = dark ? a.textDark : a.text;
            return (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => writeAccentPref(a.value)}
                className={cn(
                  "focus-ring group flex items-center gap-2.5 rounded-[var(--radius-control)] border bg-surface p-2 text-left transition-colors hover:bg-surface-sunken",
                  active ? "border-accent" : "border-line",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-chip)] text-white"
                  style={{ background: `linear-gradient(135deg, ${fill}, ${text})` }}
                >
                  {active && <Check className="h-4 w-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text">{a.label}</span>
                  <span className="block truncate text-xs text-text-muted">{a.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Canlı önizleme" className="rounded-[var(--radius-card)] border border-line bg-surface-2 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Önizleme</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">Aylık komisyon</p>
            <p className="numeric text-lg font-bold text-accent-text">₺ 184.500</p>
          </div>
          <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-xs font-semibold text-accent-text">+12%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          <div className="h-full w-2/3 rounded-full bg-accent" />
        </div>
        <div className="mt-3 flex gap-2">
          <span className="inline-flex h-8 items-center rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-accent-fg">
            Kaydet
          </span>
          <span className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-medium text-text">
            Vazgeç
          </span>
        </div>
      </section>
    </div>
  );
}
