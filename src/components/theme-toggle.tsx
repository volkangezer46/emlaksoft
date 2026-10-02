"use client";

import { useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readThemePref, subscribeTheme, writeThemePref, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Sistem", icon: Monitor },
  { value: "light", label: "Açık", icon: Sun },
  { value: "dark", label: "Koyu", icon: Moon },
];

export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  const Current = OPTIONS.find((o) => o.value === pref)?.icon ?? Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Tema seç"
        className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition-colors hover:text-text"
      >
        <Current className="h-4 w-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => writeThemePref(value)}>
            <Icon className="h-4 w-4" aria-hidden />
            <span className="flex-1">{label}</span>
            {pref === value && <Check className="h-4 w-4 text-accent" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
