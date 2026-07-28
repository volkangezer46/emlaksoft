import { cn } from "@/lib/utils";

/**
 * Badge — durum rozeti.
 *
 * v2: renkler artık tek tek Tailwind sınıfı yerine `tone-*` yardımcılarından
 * gelir (globals.css "TASARIM SİSTEMİ v2"). Kazanç:
 *  - metin tonları `--*-strong` → beyaz üzerinde WCAG AA (≥4.5:1) garanti,
 *  - koyu hero (`.theme-dark`) içinde beyaz-üstüne-beyaz üretmezler,
 *  - yeni bir durum rengi tek yerden değişir.
 *
 * Mevcut API korunur: `variant` değerleri ve `size` ölçeği aynen çalışır.
 * `neutral`, `default`'un okunur takma adıdır.
 */

export type BadgeVariant =
  | "default"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline";
type BadgeSize = "sm" | "md" | "lg";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "tone-neutral",
  neutral: "tone-neutral",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  outline: "bg-transparent text-text-muted shadow-[inset_0_0_0_1px_var(--hairline-strong)]",
};

/** Nokta göstergesinin dolgu rengi — metin rengiyle aynı aileden, bir ton canlı. */
const DOTS: Record<BadgeVariant, string> = {
  default: "bg-text-muted",
  neutral: "bg-text-muted",
  success: "bg-mint-500",
  warning: "bg-amber-500",
  danger: "bg-danger-500",
  info: "bg-brand-600",
  outline: "bg-text-faint",
};

const SIZES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
  lg: "px-3 py-1.5 text-sm gap-1.5",
};

export function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  pulse = false,
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Sol tarafta durum noktası göster (canlı/aktif durum anlatımı). */
  dot?: boolean;
  /** Noktayı yumuşakça nabız attırır — dikkat çekmesi gereken TEK rozet için.
   *  `prefers-reduced-motion` altında animasyon otomatik kapanır. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            DOTS[variant],
            pulse && "anim-pulse-soft",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * Status badge with dot — durum sözlüğü olan yerler için hazır varyantlar.
 * Badge'in `dot` moduna delege eder; renk kaynağı tek.
 */
export function StatusBadge({
  label,
  variant = "default",
  size = "md",
}: {
  label: string;
  variant?: "active" | "inactive" | "pending" | "default";
  size?: BadgeSize;
}) {
  const map: Record<string, BadgeVariant> = {
    active: "success",
    inactive: "neutral",
    pending: "warning",
    default: "info",
  };
  return (
    <Badge variant={map[variant] ?? "neutral"} size={size} dot>
      {label}
    </Badge>
  );
}
