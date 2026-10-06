import { Skeleton, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";
import { SkeletonCard } from "@/components/ui/viz";

/**
 * Raporlar: PageHeader → 4 KPI (gerçek KpiCard yüksekliği) → gelir/gider odak bloğu → bölüm kartları.
 * Yükseklikler sayfadaki içerikle eşleşir (CLS yok).
 */
export default function Loading() {
  return (
    <SkeletonPage label="Raporlar yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <SkeletonCard height={560} />
      <SkeletonCard height={224} />
      <SkeletonCard height={288} />
    </SkeletonPage>
  );
}
