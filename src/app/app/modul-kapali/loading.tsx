import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Modül kapalı sayfası: başlık + açıklama paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Modül bilgisi yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
