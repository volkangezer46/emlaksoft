import { SkeletonKpiStrip, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Başlık + KPI şeridi + tablo: anında görsel geri bildirim (kabuk hemen, veri akar). */
export default function Loading() {
  return (
    <SkeletonPage label="Muhasebe yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonKpiStrip cols={4} />
      <SkeletonTable rows={6} />
    </SkeletonPage>
  );
}
