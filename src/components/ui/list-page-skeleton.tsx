import { cn } from "@/lib/utils";
import { kpiFlowCols } from "@/components/ui/dashboard-grid";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";

/**
 * ListPageSkeleton — liste/merkez sayfalarının `loading.tsx` iskeleti; gerçek `ListPage` düzeniyle AYNI sınıflar ve
 * sıra (B021/B023): `.lp` sütunu → `ds-hero lp-hero` (başlık + özet + eylemler) → KPI kartları (`kpi-flow kpi-compact`,
 * aynı sütun kuralı) → grafik satırı (`lp-charts`, kart ~220 px) → sayfa içi sekmeler → araç çubuğu (`surface-card`) →
 * tablo / kart ızgarası. Eskiden genel "başlık + 4 KPI + tablo" iskeleti hero + 5 KPI + 2 grafikli sayfaya dönüşüyordu
 * (düzen sıçraması). Tek erişilebilir duyuru (`role="status"`); parçalar `aria-hidden`.
 */
export function ListPageSkeleton({
  label,
  actions = 2,
  kpis = 4,
  charts = 0,
  tabs = false,
  toolbar = true,
  body = "table",
  rows = 8,
}: {
  /** Ekran okuyucu duyurusu ("Müşteriler yükleniyor"). */
  label: string;
  /** Hero sağındaki eylem düğmesi sayısı. */
  actions?: number;
  /** KPI kartı sayısı (0: şerit yok). */
  kpis?: number;
  /** Grafik kartı sayısı (0-2). */
  charts?: 0 | 1 | 2;
  /** Hero altında sayfa içi sekme şeridi var mı (ör. Muhasebe). */
  tabs?: boolean;
  /** Arama/filtre araç çubuğu var mı. */
  toolbar?: boolean;
  /** Gövde: tablo satırları, kart ızgarası ya da tek büyük panel. */
  body?: "table" | "cards" | "panel";
  rows?: number;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="lp flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <section aria-hidden="true" className="ds-hero lp-hero">
        <div className="lp-hero-row">
          <div className="lp-hero-body">
            <Skeleton className="lp-eyebrow h-3 w-28" />
            <Skeleton className="mt-2 h-7 w-56 max-w-full sm:h-8" />
            <Skeleton className="lp-hero-summary mt-2 h-4 w-full max-w-md" />
          </div>
          {actions > 0 ? (
            <div className="lp-hero-actions">
              {Array.from({ length: actions }, (_, i) => (
                <Skeleton key={i} className="h-10 w-28 touch:h-11" />
              ))}
            </div>
          ) : null}
        </div>
      </section>
      {kpis > 0 ? (
        <div aria-hidden="true" className={cn("kpi-flow kpi-compact", kpiFlowCols(kpis))}>
          {Array.from({ length: kpis }, (_, i) => (
            <div key={i} className="pm-card">
              <span className="pm-card-head">
                <Skeleton className="pm-ico" />
                <Skeleton className="h-3.5 w-24" />
              </span>
              <Skeleton className="mt-1 h-7 w-16" />
            </div>
          ))}
        </div>
      ) : null}
      {charts > 0 ? (
        <div aria-hidden="true" className="lp-charts">
          {Array.from({ length: charts }, (_, i) => (
            <div key={i} className="ds-card lp-chart">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 min-h-32 flex-1 rounded-[var(--radius-card)]" />
            </div>
          ))}
        </div>
      ) : null}
      {tabs ? <Skeleton className="h-11 w-full max-w-2xl rounded-full" /> : null}
      {toolbar ? (
        <div aria-hidden="true" className="surface-card rounded-[var(--radius-panel)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 min-w-44 flex-1 touch:h-11" />
            <Skeleton className="h-9 w-28 touch:h-11" />
          </div>
        </div>
      ) : null}
      {body === "table" ? (
        <div aria-hidden="true" className="surface-card space-y-1 rounded-[var(--radius-panel)] p-2">
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : body === "cards" ? (
        <div aria-hidden="true" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: Math.min(rows, 6) }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
              <Skeleton className="h-44 rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Skeleton className="h-[26rem] rounded-[var(--radius-panel)]" />
      )}
    </div>
  );
}
