import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * StatusBadge (v3) — yalnız 3 anlam: nötr / uyarı-kritik / başarı.
 * Renk tek başına anlam taşımaz: metin her zaman verilir, ikon isteğe bağlı (aria-hidden).
 * Mevcut `Badge` ve badge.tsx içindeki eski StatusBadge'e dokunmaz.
 */
export type StatusTone = "neutral" | "attention" | "success";

const TONES: Record<StatusTone, string> = {
  neutral: "tone-neutral",
  attention: "tone-danger",
  success: "tone-success",
};

export function StatusBadge({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  /** Küçük dekoratif ikon; anlamı metin taşır. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        TONES[tone],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
