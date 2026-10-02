import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/ui/filter-params";

/**
 * StatRow — kompakt, tıklanabilir KPI satırı. "Sıfır çıkmaz metrik": `href` zorunlu,
 * her öğe filtrelenmiş hedefe gider. Değer 0 ise sönük gösterilir (yine tıklanabilir).
 */
export type StatRowItem = {
  label: string;
  /** Sayı ya da önceden biçimlenmiş metin (ör. "₺1,2 Mn"). */
  value: number | string;
  href: string;
  /** Kısa ek bilgi (ör. "bu hafta"). */
  hint?: string;
  icon?: ReactNode;
  /** Dikkat gerektiren değer: sıfır değilse vurgulanır. */
  attention?: boolean;
};

function isZero(v: number | string) {
  return v === 0 || v === "0";
}

export function StatRow({
  items,
  label = "Özet göstergeler",
  className,
}: {
  items: StatRowItem[];
  label?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]",
        className,
      )}
    >
      {items.map((it) => {
        const zero = isZero(it.value);
        const shown = typeof it.value === "number" ? formatCount(it.value) : it.value;
        return (
          <Link
            key={`${it.label}-${it.href}`}
            href={it.href}
            className={cn(
              "focus-ring flex min-h-12 flex-col justify-center rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 transition hover:border-brand-400 hover:bg-surface-2",
              zero && "opacity-60 hover:opacity-100",
            )}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
              {it.icon ? (
                <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                  {it.icon}
                </span>
              ) : null}
              <span className="truncate">{it.label}</span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  it.attention && !zero ? "text-danger-600" : "text-text",
                )}
              >
                {shown}
              </span>
              {it.hint ? <span className="truncate text-xs text-text-muted">{it.hint}</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
