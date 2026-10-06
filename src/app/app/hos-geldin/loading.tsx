import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Hoş geldin akışı: başlık + adım paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Hoş geldiniz yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
