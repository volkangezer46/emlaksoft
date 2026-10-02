import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonBlock label="Destek talepleri yükleniyor" className="space-y-4">
      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3.5">
            <Skeleton className="h-12 w-12 shrink-0 rounded-[var(--radius-card)]" />
            <div className="w-full max-w-sm space-y-2">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-7 w-52" />
              <Skeleton className="h-3.5 w-full" />
            </div>
          </div>
          <div className="hidden gap-2 sm:flex">
            <Skeleton className="h-10 w-28 rounded-[var(--radius-control)]" />
            <Skeleton className="h-10 w-40 rounded-[var(--radius-control)]" />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="surface-card min-h-[136px] rounded-[var(--radius-card)] p-4">
            <Skeleton className="h-10 w-10 rounded-[var(--radius-card)]" />
            <Skeleton className="mt-3 h-6 w-20" />
            <Skeleton className="mt-2 h-3 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface-card h-[276px] rounded-[var(--radius-panel)] p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-5 w-40" />
            <Skeleton className="mt-5 h-[176px] w-full rounded-[var(--radius-card)]" />
          </div>
        ))}
      </section>

      <section className="surface-card overflow-hidden rounded-[var(--radius-panel)]">
        <div className="flex gap-2 border-b border-hairline bg-canvas/70 p-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-[var(--radius-control)]" />
          ))}
        </div>
      </section>

      <section className="surface-card overflow-hidden rounded-[var(--radius-panel)]">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_1.4fr] gap-4 border-b border-hairline bg-canvas/70 px-4 py-3 xl:grid">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-3 w-2/3" />)}
        </div>
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-hairline p-4 last:border-b-0">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="hidden h-8 w-24 rounded-full sm:block" />
            <Skeleton className="h-9 w-28 rounded-[var(--radius-control)]" />
          </div>
        ))}
      </section>
    </SkeletonBlock>
  );
}
