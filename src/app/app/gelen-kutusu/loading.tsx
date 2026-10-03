import { Skeleton, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Gelen kutusu: PageHeader → liste (340px) + okuma paneli. */
export default function Loading() {
  return (
    <SkeletonPage label="Gelen kutusu yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[var(--radius-card)]" />
          ))}
        </div>
        <Skeleton className="h-[30rem] rounded-[var(--radius-panel)]" />
      </div>
    </SkeletonPage>
  );
}
