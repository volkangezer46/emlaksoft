import { SkeletonList } from "@/components/ui/skeleton";

/** Segmente özel yükleme sınırı: tıklar tıklamaz kabuk + sabit boyutlu iskelet (düzen kaymaz). */
export default function Loading() {
  return <SkeletonList rows={8} />;
}
