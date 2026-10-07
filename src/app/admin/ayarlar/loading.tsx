import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Başlık + ayar panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Ayarlar yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel />
      <SkeletonPanel />
    </SkeletonPage>
  );
}
