import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Anlaşmalar: PageHeader → koyu özet bandı (5 metrik) → huni + yan panel. */
export default function Loading() {
  return (
    <SkeletonPage label="Anlaşmalar yükleniyor">
      <SkeletonPageHeader actions={1} />
      <Skeleton className="h-56 rounded-[var(--radius-panel)]" />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SkeletonPanel rows={6} />
        <SkeletonPanel rows={4} />
      </div>
    </SkeletonPage>
  );
}
