import { SkeletonCard } from "@/components/ui/viz/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-5">
      <SkeletonCard height={160} label="Satış yükleniyor" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} height={80} />
        ))}
      </div>
    </div>
  );
}
