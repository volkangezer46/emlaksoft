"use client";

import { Printer } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Yazdır / PDF kaydet düğmesi — TEK KAYNAK (eskiden 9 ayrı `*\/print-button.tsx` kopyası vardı).
 *
 * NEDEN AYRI İSTEMCİ BİLEŞENİ: `window.print()` tarayıcı API'si; sayfanın geri kalanı Server Component
 * kalsın diye yalnız bu düğme istemciye iner.
 * NEDEN PDF KÜTÜPHANESİ YOK: sunucuda headless tarayıcı (~300 MB) ya da jsPDF'e Türkçe font gömmek,
 * kazanılan şeye göre çok pahalı; tarayıcının "PDF olarak kaydet" akışı (globals.css `@media print`)
 * doğru fontu, A4 kırılmasını ve seçilebilir metni zaten veriyor.
 *
 * `no-print`: düğmenin kendisi çıktıda görünmez.
 */

const TONES = {
  /** Koyu kahraman/şerit üstünde beyaz düğme. */
  light: "bg-white text-ink-950 shadow-[var(--elev-2)]",
  /** Birincil marka düğmesi. */
  brand: "bg-brand-600 text-white shadow-[var(--inner-top-dark)] hover:bg-brand-700",
  /** Açık zeminde koyu düğme. */
  dark: "bg-ink-950 text-white shadow-[var(--elev-2)] hover:bg-ink-700",
  /** Koyu zeminde yarı saydam düğme. */
  glass: "border border-white/25 bg-white/10 text-white hover:bg-white/20",
  /** İkincil (kenarlıklı) düğme. */
  outline: "border border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600",
} as const;

const SIZES = {
  sm: "gap-1.5 px-3 py-1.5 text-xs",
  md: "gap-2 px-4 py-2.5 text-sm",
} as const;

export type PrintButtonProps = {
  label?: string;
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  className?: string;
};

export function PrintButton({ label = "Yazdır / PDF", tone = "brand", size = "md", className }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={cn(
        "focus-ring press no-print inline-flex items-center rounded-[var(--radius-control)] font-semibold transition touch:min-h-11",
        size === "md" && tone !== "outline" && "btn-shine font-bold",
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      <Printer className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" /> {label}
    </button>
  );
}
