import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Sözleşme şablonları: başlık + şablon listesi. */
export default function Loading() {
  return (
    <SkeletonPage label="Sözleşme şablonları yükleniyor">
      <SkeletonPageHeader actions={1} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}
