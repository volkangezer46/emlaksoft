import { SkeletonCard } from "@/components/ui/viz/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-5">
      <SkeletonCard height={256} label="Raporlar yükleniyor" />
      <SkeletonCard height={56} />
      <SkeletonCard height={192} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard height={208} />
        <SkeletonCard height={208} />
      </div>
      <SkeletonCard height={160} />
    </div>
  );
}
