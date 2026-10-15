import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Kayıt düzenleme: başlık + iki sütun (form bölümleri ve canlı özet) iskeleti. */
export default function Loading() {
  return (
    <SkeletonPage label="Kayıt yükleniyor">
      <SkeletonPageHeader actions={0} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={2} />
        </div>
        <SkeletonPanel rows={4} />
      </div>
    </SkeletonPage>
  );
}
