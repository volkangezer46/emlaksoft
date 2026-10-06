import { SkeletonPage, SkeletonPageHeader, SkeletonPanel, SkeletonKpiStrip } from "@/components/ui/skeleton";

/** Parsel raporu: başlık + özet şeridi + rapor panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Parsel raporu yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={3} />
      <div className="grid gap-6 lg:grid-cols-3">
        <SkeletonPanel rows={5} className="lg:col-span-2" />
        <SkeletonPanel rows={4} />
      </div>
    </SkeletonPage>
  );
}
