import { SkeletonCard } from "@/components/ui/viz/skeleton-card";

export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonCard height={208} label="Gelir operasyonu yükleniyor" />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <SkeletonCard height={256} />
        <SkeletonCard height={256} />
      </div>
      <SkeletonCard height={192} />
    </div>
  );
}
