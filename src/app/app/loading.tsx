import { Skeleton, SkeletonPage, SkeletonPageHeader } from "@/components/ui/skeleton";

/**
 * /app düzeyi NÖTR ve ince yer tutucu (B023). Bu sınır /app altındaki TÜM rotaları sarar; yalnız hedef sayfanın kendi
 * loading.tsx'i henüz bilinmediğinde (önyüklenmemiş kardeş rotaya ilk tık) bir an görünür. Bu yüzden belirli bir sayfanın
 * şeklini (eskiden "Bugün" panosu) taşımaz: her merkezin ortak iskeleti olan sayfa başlığı + tek içerik bloğu.
 * Ana ekranın kendi iskeleti `(bugun)/loading.tsx`, her merkezinki kendi klasöründe.
 */
export default function AppLoading() {
  return (
    <SkeletonPage label="Sayfa yükleniyor">
      <SkeletonPageHeader actions={1} />
      <Skeleton className="h-64 rounded-[var(--radius-panel)]" />
    </SkeletonPage>
  );
}
