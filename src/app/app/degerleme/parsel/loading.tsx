import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Parsel sorgusu: başlık + sorgu formu. */
export default function Loading() {
  return (
    <SkeletonPage label="Parsel sorgusu yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
