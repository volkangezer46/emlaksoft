import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * KPI kartı — TEK giriş noktası (tasarım sistemi v4). Uygulama tek: `premium/kpi-card.tsx`
 * `KpiTile` (StatCard, KpiStrip, KpiCard hepsi onu çizer). Burada yalnız ızgara ve iskelet.
 *
 *  - `KpiCard`: `href` ZORUNLU (sıfır çıkmaz metrik); ikon karosu tonu (`tone`), trend hapı
 *    (`computeTrend`), sayaç (CountUp, ilk görünümde bir kez; reduced-motion'da anında),
 *    `tinted` tonlu zemin, `layout="inline"` (referans panel düzeni: ikon solda).
 *  - `KpiGrid`: 1 → 2 → 3 → 6 sütun akışkan ızgara; kartlar aynı satırda eşit yükseklik.
 *  - `KpiCardSkeleton`: gerçek kartla aynı ölçü (CLS yok).
 */
export { KpiCard, KpiTile, type KpiCardProps, type KpiTileProps } from "./premium/kpi-card";
export { TrendPill } from "./premium/trend-pill";
export { computeTrend, type Trend } from "./premium/premium-math";

export function KpiGrid({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6", className)}
    >
      {children}
    </div>
  );
}

export function KpiCardSkeleton({ layout = "inline", className }: { layout?: "inline" | "stack"; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pm-card pm-t-neutral h-full", layout === "inline" && "pm-card-inline", className)}>
      {layout === "inline" ? (
        <>
          <Skeleton className="h-10 w-10 shrink-0 rounded-[var(--radius-card)]" />
          <span className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </span>
        </>
      ) : (
        <>
          <span className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-[var(--radius-card)]" />
            <Skeleton className="h-4 w-24" />
          </span>
          <Skeleton className="mt-2 h-[1.875rem] w-20" />
        </>
      )}
    </div>
  );
}

/** Izgara iskeleti: `count` kart, bir canlı bölge (ekran okuyucuya tek "yükleniyor"). */
export function KpiGridSkeleton({ count = 6, label = "Göstergeler yükleniyor" }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <KpiGrid>
        {Array.from({ length: count }, (_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </KpiGrid>
    </div>
  );
}
