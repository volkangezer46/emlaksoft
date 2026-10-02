import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyStateV3 — tek boş durum bileşeni, 3 varyant:
 *  - "inline": tek satır (tablo/kart içi küçük boşluklar)
 *  - "compact": başlık + açıklama (kart içi)
 *  - "full": ikon + başlık + açıklama + eylem (sayfa/liste boşluğu)
 * `action` bir Button/Link düğümüdür; bileşen yönlendirme bilmez.
 */
export function EmptyStateV3({
  title,
  description,
  icon,
  action,
  variant = "full",
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  variant?: "inline" | "compact" | "full";
  className?: string;
}) {
  if (variant === "inline") {
    return (
      <p role="status" className={cn("flex items-center gap-2 py-3 text-sm text-text-muted", className)}>
        {icon ? (
          <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        ) : null}
        <span>
          {title}
          {description ? <span className="text-text-faint"> · {description}</span> : null}
        </span>
        {action ? <span className="ml-auto shrink-0">{action}</span> : null}
      </p>
    );
  }
  const full = variant === "full";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center text-center",
        full
          ? "gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-surface px-6 py-12"
          : "gap-1.5 px-4 py-6",
        className,
      )}
    >
      {icon && full ? (
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted [&>svg]:h-6 [&>svg]:w-6"
        >
          {icon}
        </span>
      ) : null}
      <p className={cn("font-semibold text-text", full ? "text-base" : "text-sm")}>{title}</p>
      {description ? <p className="max-w-md text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
