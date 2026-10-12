import { Skeleton, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Sahibinden ilan ekle: başlık → iki form bölümü. */
export default function Loading() {
  return (
    <SkeletonPage label="Form yükleniyor">
      <SkeletonPageHeader actions={0} />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </SkeletonPage>
  );
}
