import { SkeletonFilterBar, SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** AI kullanımı: başlık → kullanım şeridi → filtre → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="AI kullanımı yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonFilterBar />
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
