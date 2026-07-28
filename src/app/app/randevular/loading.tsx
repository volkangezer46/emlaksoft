import { Skeleton, SkeletonBlock, SkeletonLine, SkeletonStat } from "@/components/ui/skeleton";

/**
 * Randevular iskeleti — gerçek düzeni taklit eder (hero + 3 KPI + tur planı).
 * Eskiden `animate-pulse`'lı düz gri bloklardı; artık ortak `.skeleton`
 * shimmer'ı ve tek bir erişilebilir "yükleniyor" duyurusu kullanılıyor.
 */
export default function Loading() {
  return (
    <SkeletonBlock label="Randevular yükleniyor" className="space-y-6">
      <Skeleton className="h-52 rounded-[22px]" />
      <div className="grid gap-4 sm:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-3 rounded-[20px] border border-line bg-surface p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonLine key={i} />
          ))}
        </div>
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
    </SkeletonBlock>
  );
}
