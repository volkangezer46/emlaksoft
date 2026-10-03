import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonStat } from "@/components/ui/skeleton";

/** Raporlar: PageHeader → 4 KPI → bölüm kartları (grafik/ilerleme). */
export default function Loading() {
  return (
    <SkeletonPage label="Raporlar yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>
      <Skeleton className="h-44 rounded-[var(--radius-panel)]" />
      <Skeleton className="h-72 rounded-[var(--radius-panel)]" />
      <Skeleton className="h-56 rounded-[var(--radius-panel)]" />
    </SkeletonPage>
  );
}
