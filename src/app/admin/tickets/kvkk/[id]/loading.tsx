import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonBlock label="KVKK başvurusu yükleniyor" className="space-y-4">
      <Skeleton className="h-4 w-36" />
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-12 w-12 shrink-0 rounded-[var(--radius-card)]" />
          <div className="w-full max-w-md space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3.5 w-full" />
          </div>
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="surface-card space-y-2 rounded-[var(--radius-panel)] p-5">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 5 }).map((__, j) => (
              <Skeleton key={j} className="h-6 w-full" />
            ))}
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="surface-card space-y-2 rounded-[var(--radius-panel)] p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </SkeletonBlock>
  );
}
