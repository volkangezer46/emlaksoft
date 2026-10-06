import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Vitrin ayarları: başlık + ayar panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Vitrin ayarları yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
