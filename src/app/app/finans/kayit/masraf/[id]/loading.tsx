import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Masraf bildirimi ayrıntısı: başlık + özet + fiş önizlemesi iskeleti. */
export default function Loading() {
  return (
    <SkeletonPage label="Masraf bildirimi yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={3} />
      <SkeletonPanel rows={4} />
    </SkeletonPage>
  );
}
