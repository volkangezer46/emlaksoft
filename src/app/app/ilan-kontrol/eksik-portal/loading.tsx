import { SkeletonFilterBar, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Eksik portal listesi: başlık → portal süzgeci → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="Eksik portal listesi yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonFilterBar />
      <SkeletonTable rows={8} cols={3} />
    </SkeletonPage>
  );
}
