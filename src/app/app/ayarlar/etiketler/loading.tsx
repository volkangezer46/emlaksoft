import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Etiketler: başlık + etiket panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Etiketler yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
