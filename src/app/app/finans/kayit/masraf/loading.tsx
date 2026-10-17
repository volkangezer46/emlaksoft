import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Masraf bildir: başlık + form kartı + son bildirimler iskeleti. */
export default function Loading() {
  return (
    <SkeletonPage label="Masraf bildir yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
