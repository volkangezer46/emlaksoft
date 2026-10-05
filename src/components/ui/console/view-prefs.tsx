"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { writeUiPrefsCookie, type UiPrefs } from "@/lib/ui-prefs";

/**
 * Kullanıcı menüsü: "Sade görünüm" anahtarı. Tercih ofis+kullanıcı kapsamlı
 * çereze yazılır, ardından sunucu çıktısı yenilenir (menü SSR'da uygulanır). Yazı boyutu: FontScalePicker.
 */
export function ViewPrefs({ cookieName, initial }: { cookieName: string; initial: UiPrefs }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = (next: UiPrefs) => {
    setPrefs(next);
    writeUiPrefsCookie(cookieName, next);
    startTransition(() => router.refresh());
  };

  return (
    <div className="space-y-3 px-3 py-2" aria-busy={pending}>
      <button
        type="button"
        role="switch"
        aria-checked={prefs.simple}
        onClick={() => save({ ...prefs, simple: !prefs.simple })}
        className="focus-ring flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] text-left text-sm text-ink-950"
      >
        <span className="min-w-0">
          <span className="block font-semibold">Sade görünüm</span>
          <span className="block text-xs text-text-muted">{prefs.simple ? "Yalnız sık kullanılan sayfalar" : "Tüm sayfalar görünür"}</span>
        </span>
        <span
          aria-hidden
          className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", prefs.simple ? "bg-accent" : "bg-surface-sunken ring-1 ring-line")}
        >
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", prefs.simple ? "left-[1.375rem]" : "left-0.5")} />
        </span>
      </button>

    </div>
  );
}
