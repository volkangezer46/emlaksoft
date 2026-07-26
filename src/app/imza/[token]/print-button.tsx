"use client";

import { Printer } from "lucide-react";

/**
 * Yazdır / PDF kaydet düğmesi. `window.print()` tarayıcı API'si olduğu için
 * sayfanın geri kalanı Server Component kalsın diye yalnızca bu düğme istemciye
 * iner; çıktı düzeni globals.css'teki @media print altyapısını kullanır.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-1.5 rounded-[10px] border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
    >
      <Printer className="h-3.5 w-3.5" /> Yazdır / PDF kaydet
    </button>
  );
}
