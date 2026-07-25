/**
 * Badge component variants
 */

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "outline";
type BadgeSize = "sm" | "md" | "lg";

export function Badge({
  children,
  variant = "default",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}) {
  // Rozetler `ring-1 ring-inset` kullanıyor: `border` düzeni 1px büyütüp
  // satır yüksekliğini oynatıyordu. Ayrıca daha koyu metin tonu (mint-700 /
  // danger-600) beyaz üzerinde AA kontrastı sağlıyor — bu tonlar bu turda
  // tanımlandı, öncesinde sınıf sessizce düşüyordu.
  const variants: Record<BadgeVariant, string> = {
    default: "bg-ink-950/[0.055] text-ink-900 ring-1 ring-inset ring-ink-950/[0.06]",
    success: "bg-mint-500/[0.12] text-mint-700 ring-1 ring-inset ring-mint-500/25",
    warning: "bg-amber-400/[0.14] text-amber-700 ring-1 ring-inset ring-amber-400/30",
    danger: "bg-danger-500/[0.10] text-danger-600 ring-1 ring-inset ring-danger-500/25",
    info: "bg-brand-600/[0.10] text-brand-700 ring-1 ring-inset ring-brand-600/22",
    outline: "bg-transparent text-text-muted ring-1 ring-inset ring-hairline-strong",
  };

  const sizes: Record<BadgeSize, string> = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${variants[variant]} ${sizes[size]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/**
 * Status badge with dot
 */
export function StatusBadge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "active" | "inactive" | "pending" | "default";
}) {
  const variantStyles = {
    active: { bg: "bg-mint-500/10", text: "text-mint-600", dot: "bg-mint-500" },
    inactive: { bg: "bg-ink-950/5", text: "text-text-muted", dot: "bg-text-muted" },
    pending: { bg: "bg-amber-400/10", text: "text-amber-600", dot: "bg-amber-400" },
    default: { bg: "bg-brand-600/10", text: "text-brand-600", dot: "bg-brand-600" },
  };

  const style = variantStyles[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style.bg} ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}