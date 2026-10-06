import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Ofis Merkezi: başlık + sekme panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Ofis Merkezi yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
