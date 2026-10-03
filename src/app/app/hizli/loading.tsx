import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Hızlı kayıt: başlık + tek form paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Hızlı kayıt yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={4} />
    </SkeletonPage>
  );
}
