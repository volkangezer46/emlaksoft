import { SkeletonFilterBar, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** İlan kontrol listesi: başlık → filtre → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="İlan kontrol listesi yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonFilterBar />
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
