import { SkeletonFilterBar, SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Anketör kuyruğu: başlık → KPI → filtre → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="Anket kuyruğu yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonFilterBar />
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
