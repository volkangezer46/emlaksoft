import { SkeletonCard } from "@/components/ui/viz";

/** Sabit yükseklikli iskelet (başlık, sekme şeridi, 4 KPI, nakit akışı + yaklaşanlar): içerik gelince düzen kaymaz (CLS=0). */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard height={144} label="Sayfa yükleniyor" />
      <div className="skeleton h-11 w-full max-w-2xl rounded-full" aria-hidden="true" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
        <SkeletonCard variant="card" height={128} lines={2} label="Kart yükleniyor" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <SkeletonCard height={360} label="Nakit akışı yükleniyor" />
        <SkeletonCard variant="card" height={360} lines={5} label="Yaklaşanlar yükleniyor" />
      </div>
    </div>
  );
}
