import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";

/** Komisyon: PageHeader → koyu özet bandı (3 metrik) → özet panel → tablo. */
export default function Loading() {
  return (
    <SkeletonPage label="Komisyon yükleniyor">
      <SkeletonPageHeader actions={1} />
      <Skeleton className="h-44 rounded-[var(--radius-panel)]" />
      <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
      <SkeletonTable rows={7} cols={4} />
    </SkeletonPage>
  );
}
