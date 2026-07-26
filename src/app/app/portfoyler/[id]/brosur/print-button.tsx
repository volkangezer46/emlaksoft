"use client";

import { Printer } from "lucide-react";

/**
 * Yazdır / PDF düğmesi (degerleme/[id]/print-button deseni).
 *
 * NEDEN AYRI BİR CLIENT COMPONENT: `window.print()` tarayıcı API'si; broşürün
 * geri kalanı Server Component olarak kalsın diye yalnızca bu düğme istemciye
 * iniyor. PDF kütüphanesi yok — tarayıcının "PDF olarak kaydet" akışı doğru
 * fontu ve A4 kırılmasını zaten veriyor.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-shine focus-ring press no-print inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-[var(--inner-top-dark)] transition hover:bg-brand-700"
    >
      <Printer className="h-4 w-4" /> Yazdır / PDF
    </button>
  );
}
