import { SkeletonCard } from "@/components/ui/viz";

/** Satış hızı: başlık → dönem/kapsam çubuğu → 4 KPI → huni → kaynak tablosu (içerik yükseklikleriyle eşleşir, CLS yok). */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Satış hızı yükleniyor">
      <SkeletonCard height={96} />
      <SkeletonCard height={112} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} height={112} />
        ))}
      </div>
      <SkeletonCard height={300} />
      <SkeletonCard height={256} />
    </div>
  );
}
