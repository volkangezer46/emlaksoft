import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <SkeletonCard height={176} label="Büyüme başlığı yükleniyor" />
      <SkeletonCard height={320} label="Referans hunisi yükleniyor" />
      <SkeletonCard height={240} label="Talep kuyruğu yükleniyor" />
    </div>
  );
}
