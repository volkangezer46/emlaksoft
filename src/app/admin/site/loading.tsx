import { SkeletonKpiStrip, SkeletonList, SkeletonPageHeader } from "@/components/ui/skeleton";

/** Segmente özel yükleme sınırı: başlık + Kokpit kutucukları + kuyruk/Yayın masası iskeleti (sabit boyut, düzen kaymaz). */
export default function Loading() {
  return (
    <div className="space-y-6">
      <SkeletonPageHeader />
      <SkeletonKpiStrip cols={4} />
      <SkeletonList rows={6} />
    </div>
  );
}
