import Link from "next/link";
import { cn } from "@/lib/utils";

export type BarDatum = { label: string; value: number; href?: string };

/**
 * Dikey çubuk grafiği (saf CSS, sunucu bileşeni). Son çubuk vurgulu, diğerleri soluk.
 * `data` boşsa `null`; çağıran boş durum gösterir. Çubuk `href` verilirse bağlantıdır.
 */
export function BarChart({
  data,
  ariaLabel,
  format = (n) => String(n),
  tone = "accent",
  height = 128,
  highlightLast = true,
  className,
}: {
  data: readonly BarDatum[];
  ariaLabel: string;
  format?: (n: number) => string;
  tone?: "accent" | "gold";
  height?: number;
  highlightLast?: boolean;
  className?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const color = tone === "gold" ? "var(--gold-500)" : "var(--accent)";
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex items-end gap-2", className)} style={{ height: height + 40 }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1;
        const strong = !highlightLast || isLast;
        const body = (
          <>
            <span className={cn("num text-xs", strong ? "text-text" : "text-text-muted")}>{format(d.value)}</span>
            <span className="flex w-full flex-1 items-end justify-center">
              <span
                className="con-bar block w-full max-w-9 rounded-t-md"
                style={{
                  height: `${Math.max((d.value / max) * 100, d.value > 0 ? 6 : 2)}%`,
                  background: color,
                  opacity: strong ? 1 : 0.38,
                  animationDelay: `${i * 30}ms`,
                }}
              />
            </span>
            <span className={cn("max-w-full truncate text-xs", strong ? "font-medium text-text" : "text-text-faint")}>{d.label}</span>
          </>
        );
        const cls = "flex h-full min-w-0 flex-1 flex-col items-center gap-1.5 rounded-[var(--radius-control)]";
        return d.href ? (
          <Link key={d.label} href={d.href} className={cn(cls, "focus-ring transition-opacity hover:opacity-80")}>
            {body}
          </Link>
        ) : (
          <div key={d.label} className={cls}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
