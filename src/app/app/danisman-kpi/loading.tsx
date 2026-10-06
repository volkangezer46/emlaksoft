import { SkeletonCard } from "@/components/ui/viz";

/** Danışman KPI: başlık → özet KPI → podyum → tempo kartı → ekip metrikleri → grafik/tablo (içerik yükseklikleriyle). */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Danışman performansı yükleniyor">
      <SkeletonCard height={104} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} height={112} />
        ))}
      </div>
      <SkeletonCard height={256} />
      <SkeletonCard height={176} />
      <SkeletonCard height={320} />
    </div>
  );
}
