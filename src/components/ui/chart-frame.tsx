import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Illustration, type IllustrationKind } from "@/components/ui/illustrations";
import { SkeletonCard } from "@/components/ui/viz/skeleton-card";

/* Recharts içermez — grafik paketinden bağımsız tutulur ki yalnız çerçeve isteyen sayfa recharts taşımasın. */

/**
 * Kart çerçevesi (= ChartCard) — panel kartlarıyla aynı yüzey/gölge/köşe değerleri.
 * Eski kullanım (title, subtitle, action, children, className, height) aynen çalışır.
 * Ek: `period` (dönem çipi), `href` (ayrıntı bağlantısı: sıfır çıkmaz metrik), `loading`
 * (sabit yükseklikli iskelet), `empty` (veri yoksa anlamlı boş durum; gövde çizilmez).
 */
export function ChartFrame({
  title,
  subtitle,
  action,
  children,
  className,
  height = 260,
  period,
  href,
  hrefLabel = "Ayrıntı",
  loading = false,
  empty = false,
  emptyText = "Henüz veri yok",
  emptyIllustration = "rapor",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  height?: number;
  /** Dönem etiketi (ör. "Son 30 gün"). */
  period?: string;
  /** Grafiğin ayrıntı/filtrelenmiş hedefi. */
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  emptyIllustration?: IllustrationKind;
}) {
  return (
    <section className={cn("surface-card rounded-[var(--radius-panel)] p-5", className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold tracking-[-0.015em] text-ink-950">{title}</h3>
          {subtitle || period ? (
            <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.04em] text-text-faint">
              {[subtitle, period].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {action}
          {href ? (
            <Link href={href} className="text-xs font-semibold text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
              {hrefLabel} →
            </Link>
          ) : null}
        </div>
      </header>
      <div style={{ height }}>
        {loading ? (
          <SkeletonCard height="100%" label={`${title} yükleniyor`} />
        ) : empty ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Illustration kind={emptyIllustration} size={112} />
              <p className="mt-2 text-sm text-text-muted">{emptyText}</p>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export { ChartFrame as ChartCard };
