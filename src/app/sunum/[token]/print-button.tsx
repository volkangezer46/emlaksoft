"use client";

import { Printer } from "lucide-react";

/**
 * "Yazdır / PDF kaydet" — cuzdan/print-button.tsx deseni. `window.print()`
 * tarayıcı API'si olduğundan yalnız bu düğme istemciye iner; PDF kütüphanesi
 * bilinçli olarak yok (globals.css `@media print` doğru kırılmayı veriyor).
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-shine focus-ring press no-print inline-flex items-center gap-2 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-bold text-white shadow-[var(--elev-2)]"
    >
      <Printer className="h-4 w-4" /> Yazdır / PDF kaydet
    </button>
  );
}
