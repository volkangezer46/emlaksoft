import { SkeletonFilterBar, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** İlan uyarı kuyruğu: başlık → filtre → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="İlan uyarı kuyruğu yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonFilterBar />
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
