"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSelectMode } from "./select-mode";

/**
 * BulkBar — toplu işlem çubuğu kabuğu (seçim sayısı + eylemler + temizle).
 * Saf sunum: seçim durumu ve eylemler çağıranın (istemci sağlayıcısının) işidir;
 * çubuk yalnız seçim varken çağıran tarafından çizilir. Satırların üstünde
 * sticky durur, böylece uzun listede de eylemler erişilebilir kalır.
 * Görünürken `.motion-enter` ile yumuşak belirir (CSS `@starting-style`; JS yok).
 * Sade modda (liste kapsamı `SelectModeScope`) seçim kutuları "Seç" moduna kadar gizli olduğundan çubuk da seçim
 * yapılmadan görünmez; "Seçimi bitir" ile mod kapanınca seçim temizlenir (gizli kutularla görünmez seçim kalmasın).
 */
export function BulkBar({
  count,
  noun,
  onClear,
  children,
  className,
}: {
  count: number;
  /** "portföy", "müşteri" … */
  noun: string;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}) {
  const mode = useSelectMode();
  const prev = useRef(mode);
  useEffect(() => {
    // Yalnız "Seç" → kapalı geçişinde temizle (kapsam dışı/kutusu görünen listelerde seçim bozulmaz).
    if (prev.current === "on" && mode === "off" && count > 0) onClear();
    prev.current = mode;
  }, [mode, count, onClear]);
  return (
    <div
      role="region"
      aria-label="Toplu işlemler"
      className={cn(
        "motion-enter sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/50 bg-surface px-4 py-2.5 shadow-[var(--shadow-lg)]",
        className,
      )}
    >
      <span className="numeric text-sm font-semibold text-brand-700">
        {count} {noun} seçildi
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Seçimi temizle"
        className="focus-ring ml-auto grid h-8 w-8 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-surface-hover hover:text-text active:bg-surface-pressed"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
