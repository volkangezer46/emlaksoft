import { Skeleton, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Sahibinden ilan detayı: başlık → kart → iki sütun (zaman çizelgesi / fiyat geçmişi). */
export default function Loading() {
  return (
    <SkeletonPage label="İlan kaydı yükleniyor">
      <SkeletonPageHeader actions={0} />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </SkeletonPage>
  );
}
