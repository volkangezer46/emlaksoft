"use client";

import { Printer } from "lucide-react";

/**
 * "Cep raporu yazdır" düğmesi.
 *
 * degerleme/[id]/print-button.tsx ile aynı gerekçe: `window.print()` tarayıcı
 * API'si olduğu için yalnız bu düğme istemciye iner; sayfanın kalanı Server
 * Component kalır. PDF kütüphanesi bilinçli olarak yok — tarayıcının "PDF
 * olarak kaydet" akışı doğru fontu ve kırılmayı zaten veriyor.
 */
export function PrintReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="focus-ring press no-print inline-flex items-center gap-1.5 rounded-[9px] bg-ink-950 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-700"
    >
      <Printer className="h-3.5 w-3.5" /> Cep raporu yazdır
    </button>
  );
}
