import { SkeletonPage, SkeletonPageHeader, SkeletonTable } from "@/components/ui/skeleton";
import { SkeletonCard } from "@/components/ui/viz";

/** Komisyon: PageHeader → 3 KPI → odak blok (dönem + durum yığını) → tablo. Yükseklikler içerikle eşleşir. */
export default function Loading() {
  return (
    <SkeletonPage label="Komisyon yükleniyor">
      <SkeletonPageHeader actions={1} />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} height={128} />
        ))}
      </div>
      <SkeletonCard height={400} />
      <SkeletonTable rows={7} cols={4} />
    </SkeletonPage>
  );
}
