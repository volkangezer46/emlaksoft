import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Bölge bildirimi: başlık + form paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Bölge bildirimi yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
