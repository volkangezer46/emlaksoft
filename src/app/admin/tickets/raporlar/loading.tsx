import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";
import { KpiGridSkeleton } from "@/components/ui/kpi-card";

export default function Loading() {
  return (
    <SkeletonBlock label="Destek raporları yükleniyor" className="space-y-4">
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-16 w-full rounded-[var(--radius-panel)]" />
      <KpiGridSkeleton count={5} label="Destek göstergeleri yükleniyor" />
      <Skeleton className="h-56 w-full rounded-[var(--radius-panel)]" />
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-[var(--radius-panel)]" />
        ))}
      </div>
    </SkeletonBlock>
  );
}
