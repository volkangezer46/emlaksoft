import { SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Başlık + KPI şeridi + sayfa envanteri tablosu. */
export default function Loading() {
  return (
    <SkeletonPage label="SEO yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonTable rows={8} />
    </SkeletonPage>
  );
}
