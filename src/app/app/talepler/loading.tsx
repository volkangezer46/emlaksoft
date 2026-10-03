import { SkeletonFilterBar, SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Talepler: PageHeader → 3'lü KPI kartı → filtre → kart listesi. */
export default function Loading() {
  return (
    <SkeletonPage label="Talepler yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={3} />
      <SkeletonFilterBar />
      <SkeletonPanel rows={8} title={false} />
    </SkeletonPage>
  );
}
