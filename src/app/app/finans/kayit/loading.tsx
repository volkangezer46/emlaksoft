import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Kayıt çalışma alanı: başlık + sekme şeridi + iki sütun (form bölümleri ve canlı özet) iskeleti. */
export default function Loading() {
  return (
    <SkeletonPage label="Kayıt formu yükleniyor">
      <SkeletonPageHeader actions={0} />
      <div className="skeleton h-12 w-full max-w-xl rounded-full" aria-hidden="true" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={2} />
          <SkeletonPanel rows={2} />
        </div>
        <SkeletonPanel rows={4} />
      </div>
    </SkeletonPage>
  );
}
