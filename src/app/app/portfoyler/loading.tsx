import { Skeleton, SkeletonFilterBar, SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Portföyler: PageHeader → özet kart → filtre → kart ızgarası (md:2, xl:3). */
export default function Loading() {
  return (
    <SkeletonPage label="Portföyler yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonFilterBar />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
            <Skeleton className="h-44 rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-6 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
