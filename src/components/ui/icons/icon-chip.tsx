import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/**
 * IconChip — kart başlığı / durum çipi / liste satırı için TEK ikon karosu (premium v5).
 * Ton mevcut `.pm-t-*` ailesidir (yeni ton sınıfı yazılmaz; AA testli `--t` / `--t-text`). Görünüm
 * `console-premium.css` `.ic-chip`: tonlu degrade + iç halka + üst ışık; `solid` dolgulu (beyaz ikon).
 * Dekoratif: aria-hidden (anlam yanındaki metindedir).
 */
export type IconChipTone = "brand" | "success" | "warn" | "danger" | "gold" | "neutral";

export function IconChip({
  icon: Icon,
  tone = "brand",
  size = "md",
  variant = "soft",
  className,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: IconChipTone;
  size?: "sm" | "md" | "lg";
  variant?: "soft" | "solid";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-size={size === "md" ? undefined : size}
      data-variant={variant === "soft" ? undefined : variant}
      className={cn("ic-chip", `pm-t-${tone}`, className)}
    >
      <Icon aria-hidden />
    </span>
  );
}
