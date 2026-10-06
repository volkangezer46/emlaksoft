import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Yeni portföy sunumu: başlık + form paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Yeni sunum yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
