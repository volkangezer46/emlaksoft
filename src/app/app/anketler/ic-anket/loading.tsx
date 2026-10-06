import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Ekip nabzı: başlık + form / toplu sonuç panelleri. */
export default function Loading() {
  return (
    <SkeletonPage label="Ekip nabzı yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
