"use client";

import { Search } from "lucide-react";
import { KbdCombo } from "@/components/ui/kbd";

/**
 * Yönetim arama kutusu düğmesi — hafif kabuk (`command-palette-lazy.tsx`) ve palet gövdesi (`command-palette.tsx`)
 * AYNI düğmeyi çizer (gövde yüklenince kutu sıçramaz).
 */
export function PaletteTrigger({ open, onOpen, onWarm }: { open: boolean; onOpen: () => void; onWarm?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls="admin-command-results"
      aria-label="Platform genelinde ara"
      className="focus-ring group flex h-11 w-full items-center gap-3 rounded-full border border-hairline bg-surface-raised px-4 text-sm text-text-muted shadow-[var(--elev-1)] transition hover:border-border-interactive hover:text-text hover:shadow-[var(--elev-2)]"
    >
      <Search className="h-4 w-4 shrink-0 transition group-hover:text-accent-text" aria-hidden />
      <span className="hidden min-w-0 flex-1 truncate text-left text-sm sm:block">Ofis, üye, talep ara…</span>
      <span className="ml-auto hidden shrink-0 lg:inline-flex">
        <KbdCombo keys={["mod", "K"]} />
      </span>
    </button>
  );
}
