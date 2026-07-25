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
  const variants: Record<BadgeVariant, string> = {
    default: "bg-ink-950/5 text-ink-950",
    success: "bg-mint-500/10 text-mint-600 border border-mint-500/20",
    warning: "bg-amber-400/10 text-amber-600 border border-amber-400/20",
    danger: "bg-danger-500/10 text-danger-500 border border-danger-500/20",
    info: "bg-brand-600/10 text-brand-600 border border-brand-600/20",
    outline: "border border-line bg-transparent text-text-muted",
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