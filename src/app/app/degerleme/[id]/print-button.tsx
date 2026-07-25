"use client";

import { Printer } from "lucide-react";

/**
 * Yazdır / PDF düğmesi.
 *
 * NEDEN AYRI BİR CLIENT COMPONENT: `window.print()` tarayıcı API'si; sayfanın
 * geri kalanı Server Component olarak kalsın diye yalnızca bu düğme istemciye
 * iniyor.
 *
 * NEDEN PDF KÜTÜPHANESİ YOK: Sunucuda headless tarayıcı (Puppeteer ~300 MB)
 * çalıştırmak ya da jsPDF'e Türkçe font gömmek, kazanılan şeye göre çok
 * pahalı. Tarayıcının kendi "PDF olarak kaydet" akışı doğru fontu, doğru
 * sayfa kırılmasını ve seçilebilir metni zaten veriyor.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-shine focus-ring press no-print inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
    >
      <Printer className="h-4 w-4" /> Yazdır / PDF
    </button>
  );
}
