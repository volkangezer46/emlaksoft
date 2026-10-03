import { SkeletonKpiStrip, SkeletonLine, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Randevular: PageHeader → KPI şeridi → tur planı + yan panel. */
export default function Loading() {
  return (
    <SkeletonPage label="Randevular yükleniyor">
      <SkeletonPageHeader actions={2} />
      <SkeletonKpiStrip cols={3} />
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {[6, 4].map((n, k) => (
          <div key={k} className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            {Array.from({ length: n }).map((_, i) => (
              <SkeletonLine key={i} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
