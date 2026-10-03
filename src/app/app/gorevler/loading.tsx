import { Skeleton, SkeletonPage, SkeletonPageHeader, SkeletonRow } from "@/components/ui/skeleton";

/** Görevler: PageHeader → sekme çubuğu kartı (p-2) → görev satırları. */
export default function Loading() {
  return (
    <SkeletonPage label="Görevler yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </SkeletonPage>
  );
}
