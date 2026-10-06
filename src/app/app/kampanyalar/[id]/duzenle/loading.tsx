import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Kampanya düzenleme: başlık + form paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Kampanya yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={6} title={false} />
    </SkeletonPage>
  );
}
