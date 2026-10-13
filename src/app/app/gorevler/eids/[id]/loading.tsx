import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonRow } from "@/components/ui/skeleton";

/** EİDS kaldırma görevi: başlık → üç özet kutusu → yasal not → kontrol listesi. */
export default function Loading() {
  return (
    <SkeletonPage label="Kaldırma görevi yükleniyor">
      <SkeletonPageHeader />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </SkeletonPage>
  );
}
