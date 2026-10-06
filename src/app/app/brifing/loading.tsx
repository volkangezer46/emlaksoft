import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Brifing (ana ekrana yönlenir): yönlendirme anında boş ekran yerine iskelet. */
export default function Loading() {
  return (
    <SkeletonPage label="Brifing yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
