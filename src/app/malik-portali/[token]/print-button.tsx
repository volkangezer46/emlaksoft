"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700"
    >
      <Printer className="h-3.5 w-3.5" aria-hidden /> Yazdır / PDF
    </button>
  );
}
