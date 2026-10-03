import { SkeletonPage, SkeletonPageHeader, SkeletonPanel } from "@/components/ui/skeleton";

/** Yeni kayıt formu: başlık + iki bölüm paneli (liste iskeleti yerine form biçimi). */
export default function Loading() {
  return (
    <SkeletonPage label="Form yükleniyor">
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={3} />
    </SkeletonPage>
  );
}