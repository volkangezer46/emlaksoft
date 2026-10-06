import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Talep-arz haritası yükleniyor">
      <SkeletonCard height={160} />
      <SkeletonCard height={40} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} height={128} />
        ))}
      </div>
      <SkeletonCard height={288} />
      <SkeletonCard height={256} />
      <SkeletonCard height={460} />
    </div>
  );
}
