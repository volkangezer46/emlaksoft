import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Card — tek yüzey reçetesi. Sayfalarda elle yazılan
 * `rounded-[…] border bg-white shadow-…` kombinasyonlarının yerine geçer.
 * Dark mod için yalnız token kullanır (bg-surface, border-line).
 */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-1)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("flex items-start justify-between gap-3 border-b border-line px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-sm font-semibold text-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-xs text-text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      className={cn("flex items-center justify-end gap-2 border-t border-line px-5 py-3", className)}
      {...props}
    />
  );
}
