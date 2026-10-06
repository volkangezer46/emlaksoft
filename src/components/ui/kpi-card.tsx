import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid } from "./dashboard-grid";

/**
 * KPI kartı — TEK giriş noktası (tasarım sistemi v4). Uygulama tek: `premium/kpi-card.tsx`
 * `KpiTile` (StatCard, KpiStrip, KpiCard hepsi onu çizer). Burada yalnız ızgara ve iskelet.
 *
 *  - `KpiCard`: `href` ZORUNLU (sıfır çıkmaz metrik); ikon karosu tonu (`tone`), trend hapı
 *    (`computeTrend`), sayaç (CountUp, ilk görünümde bir kez; reduced-motion'da anında),
 *    `tinted` tonlu zemin, `layout="inline"` (referans panel düzeni: ikon solda).
 *  - `KpiGrid`: TEK uygulama `ui/dashboard-grid` (boşluksuz esnek ızgara; satır her zaman dolar). Buradan yeniden dışa aktarılır.
 *  - `KpiCardSkeleton`: gerçek kartla aynı ölçü (CLS yok).
 */
export { KpiCard, KpiTile, type KpiCardProps, type KpiTileProps } from "./premium/kpi-card";
export { TrendPill } from "./premium/trend-pill";
export { computeTrend, type Trend } from "./premium/premium-math";

export { KpiGrid } from "./dashboard-grid";

export function KpiCardSkeleton({ layout = "inline", className }: { layout?: "inline" | "stack"; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pm-card pm-t-neutral h-full", layout === "inline" && "pm-card-inline", className)}>
      {layout === "inline" ? (
        <>
          <Skeleton className="h-9 w-9 shrink-0 rounded-[var(--radius-card)]" />
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
      <KpiGrid count={count} stagger={false}>
        {Array.from({ length: count }, (_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </KpiGrid>
    </div>
  );
}
