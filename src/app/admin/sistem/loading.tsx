import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <SkeletonCard height={176} label="Sistem başlığı yükleniyor" />
      <SkeletonCard height={120} label="Cron durum şeridi yükleniyor" />
      <SkeletonCard height={360} label="Sistem ayrıntıları yükleniyor" />
    </div>
  );
}
