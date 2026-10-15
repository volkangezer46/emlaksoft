import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Paylaşım karşılama: başlık + içerik paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Paylaşılan içerik yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={4} />
    </SkeletonPage>
  );
}
