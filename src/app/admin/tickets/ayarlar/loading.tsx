import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonBlock label="Destek ayarları yükleniyor" className="space-y-4">
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-16 w-full rounded-[var(--radius-panel)]" />
      <div className="flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-36 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-[var(--radius-panel)]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-[var(--radius-panel)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-panel)]" />
      </div>
    </SkeletonBlock>
  );
}
