import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Recharts içermez — grafik paketinden bağımsız tutulur ki yalnız çerçeve isteyen sayfa recharts taşımasın. */

/** Kart çerçevesi — panel kartlarıyla aynı yüzey/gölge/köşe değerleri. */
export function ChartFrame({
  title,
  subtitle,
  action,
  children,
  className,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <section
      className={cn("surface-card rounded-[var(--radius-panel)] p-5", className)}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold tracking-[-0.015em] text-ink-950">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.04em] text-text-faint">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      <div style={{ height }}>{children}</div>
    </section>
  );
}
