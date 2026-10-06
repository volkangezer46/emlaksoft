import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="skeleton h-20 w-full rounded-[var(--radius-card)]" role="status" aria-label="Sayfa yükleniyor" />
      <SkeletonCard height={168} label="Göstergeler yükleniyor" />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard height={260} label="Portföy sağlığı yükleniyor" />
        <SkeletonCard height={260} label="Kritik işler yükleniyor" />
      </div>
    </div>
  );
}
