import { SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Başlık + KPI şeridi + satış kuyruğu tablosu. */
export default function Loading() {
  return (
    <SkeletonPage label="Satış yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonTable rows={6} />
    </SkeletonPage>
  );
}
