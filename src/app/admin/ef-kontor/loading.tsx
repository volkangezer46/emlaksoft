import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard height={96} label="Kontör özeti yükleniyor" />
      <SkeletonCard height={420} label="Kontör ekonomisi yükleniyor" />
      <SkeletonCard height={160} label="Son mutabakat yükleniyor" />
    </div>
  );
}
