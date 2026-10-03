import { SkeletonFilterBar, SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Müşteriler: PageHeader → bölünmüş KPI kartı → filtre → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="Müşteriler yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonFilterBar />
      <SkeletonTable rows={10} cols={5} />
    </SkeletonPage>
  );
}
