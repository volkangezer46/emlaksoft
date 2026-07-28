/**
 * Skeleton primitives — premium shimmer loading states
 * Dashboard/list ekranları veri gelene kadar gerçek layout'u taklit eder.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  // v2: `.shimmer` yalnızca saydam bir parlama gradyanıdır ve `background`
  // kısayolunu ezdiği için `bg-canvas` tabanı sessizce kayboluyordu (iskeletler
  // görünmezdi). `.skeleton` taban rengi + parlamayı birlikte verir ve
  // prefers-reduced-motion altında kendini kapatır.
  return <div aria-hidden="true" className={`skeleton relative overflow-hidden rounded-[10px] ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-[18px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-[12px]" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-20" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas px-3 py-2.5">
      <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-[20px]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Skeleton className="h-72 rounded-[20px]" />
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2.5 rounded-[18px] border border-line bg-surface p-5">
            <Skeleton className="h-4 w-1/2" />
            {Array.from({ length: 3 }).map((__, j) => (
              <SkeletonRow key={j} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-[22px]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="space-y-2.5 rounded-[18px] border border-line bg-surface p-5">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
