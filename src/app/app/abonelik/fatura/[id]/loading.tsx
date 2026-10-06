import { SkeletonPage, SkeletonPageHeader, SkeletonPanel, SkeletonKpiStrip } from "@/components/ui/skeleton";

/** Fatura detayı: başlık + tutar şeridi + kalemler/ödeme paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Fatura yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={3} />
      <div className="grid gap-6 lg:grid-cols-3">
        <SkeletonPanel rows={5} className="lg:col-span-2" />
        <SkeletonPanel rows={4} />
      </div>
    </SkeletonPage>
  );
}
