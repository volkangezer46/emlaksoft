import { SkeletonCard } from "@/components/ui/viz";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Memnuniyet yükleniyor">
      <SkeletonCard height={224} />
      <SkeletonCard height={256} />
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard height={288} />
        <SkeletonCard height={288} />
      </div>
      <SkeletonCard height={256} />
    </div>
  );
}
