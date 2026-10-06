import { SkeletonCard } from "@/components/ui/viz";

/** Aday hızı: başlık → süzgeç satırı → 4 KPI → danışman tablosu (içerik yükseklikleriyle eşleşir, CLS yok). */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Aday hızı yükleniyor">
      <SkeletonCard height={96} />
      <SkeletonCard height={40} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} height={112} />
        ))}
      </div>
      <SkeletonCard height={256} />
    </div>
  );
}
