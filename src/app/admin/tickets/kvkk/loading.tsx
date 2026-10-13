import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonBlock label="KVKK talepleri yükleniyor" className="space-y-4">
      <div className="flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <div className="flex items-center gap-3.5">
          <Skeleton className="h-12 w-12 shrink-0 rounded-[var(--radius-card)]" />
          <div className="w-full max-w-sm space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-3.5 w-full" />
          </div>
        </div>
      </section>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface-card min-h-[88px] rounded-[var(--radius-card)] p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-6 w-12" />
          </div>
        ))}
      </section>
      <div className="surface-card space-y-2 rounded-[var(--radius-panel)] p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </SkeletonBlock>
  );
}
