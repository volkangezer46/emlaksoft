import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Yardım ve destek: başlık + konu panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Yardım yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
