"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

/**
 * Mobil vitrin filtre katlanır paneli: dar ekranda "Filtrele (n)" düğmesi arkasında kapalı gelir,
 * böylece ilanlar ilk ekranda görünür. Geniş ekranda panel her zaman açıktır. Form sunucuda
 * çizilir (children); burada yalnız görünürlük durumu tutulur.
 */
export function VitrinFilterPanel({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vitrin-filtre-paneli"
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-white/20 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15 lg:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filtrele
        {activeCount > 0 ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-mint-500 px-1.5 text-xs font-extrabold text-ink-950">
            {activeCount}
          </span>
        ) : null}
      </button>
      <div id="vitrin-filtre-paneli" className={`${open ? "mt-3 block" : "hidden"} lg:mt-0 lg:block`}>
        {children}
      </div>
    </div>
  );
}
