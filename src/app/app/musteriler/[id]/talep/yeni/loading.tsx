import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Yeni talep formu: başlık + form paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Yeni talep yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
