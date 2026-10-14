import { SkeletonCard } from "@/components/ui/viz";

/** Yetki uyum raporu: başlık → 6 KPI → danışman tablosu. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Yetki uyum raporu yükleniyor">
      <SkeletonCard height={96} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} height={112} />
        ))}
      </div>
      <SkeletonCard height={220} />
    </div>
  );
}
