import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Card — TEK yüzey reçetesi (premium tema): saç teli kenar + iki katmanlı yumuşak gölge (`--card-shadow`) + 16 px köşe
 * (`--radius-surface`) + 16 px iç boşluk. Renkli üst çizgi / degrade yok. Sayfalarda elle yazılan
 * `rounded-[…] border bg-white shadow-…` kombinasyonlarının yerine geçer. Dark mod için yalnız token kullanır.
 */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-surface)] border border-hairline bg-surface shadow-[var(--card-shadow)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn("flex items-start justify-between gap-3 border-b border-hairline px-4 py-3.5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("t-card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-0.5 text-[length:var(--fs-label)] text-text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      className={cn("flex items-center justify-end gap-2 border-t border-hairline px-4 py-3", className)}
      {...props}
    />
  );
}
