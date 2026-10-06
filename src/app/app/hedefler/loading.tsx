import { SkeletonCard } from "@/components/ui/viz";

/** Sabit yükseklikli iskelet: içerik gelince düzen kaymaz (CLS=0). */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard height={144} label="Sayfa yükleniyor" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
      </div>
      <SkeletonCard height={288} label="Grafik yükleniyor" />
    </div>
  );
}
