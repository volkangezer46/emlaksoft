"use client";

import { Printer } from "lucide-react";

/**
 * Dönem bordrosu yazdır — degerleme/[id]/print-button.tsx deseni.
 * `window.print()` tarayıcı API'si olduğundan yalnızca bu düğme istemciye iner.
 * PDF kütüphanesi bilinçli olarak yok: tarayıcının "PDF olarak kaydet" akışı
 * (globals.css `@media print`) doğru fontu ve sayfa kırılmasını zaten veriyor.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-shine focus-ring press no-print inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
    >
      <Printer className="h-4 w-4" /> Dönem bordrosu yazdır
    </button>
  );
}
