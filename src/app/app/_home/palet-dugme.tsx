"use client";

import { Search } from "lucide-react";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-core";

/** Başlık satırındaki komut araması düğmesi (kenar çubuğundaki aramayla aynı olayı yayar). */
export function PaletDugme() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      aria-label="Komut araması aç (Ctrl veya ⌘ + K)"
      className="focus-ring press inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold text-text-muted transition hover:bg-surface-hover hover:text-ink-950"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Ara</span>
      <kbd className="pm-kbd hidden sm:inline">⌘K</kbd>
    </button>
  );
}
