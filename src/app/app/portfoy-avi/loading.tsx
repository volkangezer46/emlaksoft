import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonRow } from "@/components/ui/skeleton";

/** Sahibinden ilanlar: PageHeader → KPI şeridi → filtre çubuğu → ilan kartları. */
export default function Loading() {
  return (
    <SkeletonPage label="Sahibinden ilanlar yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </SkeletonPage>
  );
}
