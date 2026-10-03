import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * StatusPill — renkli durum kapsülü (Aktif / Öne çıkan / Pasif görünümü).
 * Renkler `tone-*` token'larından gelir (kontrast garantili; açık/koyu tema ve
 * tüm vurgu temalarında uyumlu). Anlamı metin taşır; nokta dekoratiftir.
 * Eski `StatusBadge` yalnız 3 anlam içindir; çok durumlu listeler için bu kullanılır.
 */
export type PillTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_CLASS: Record<PillTone, string> = {
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  neutral: "tone-neutral",
};

export function StatusPill({
  tone = "neutral",
  children,
  dot = true,
  className,
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
