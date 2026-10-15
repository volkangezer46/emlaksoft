import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Portföyler: liste hero → 6 KPI → 2 grafik → araç çubuğu → liste (varsayılan görünüm; gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Portföyler yükleniyor" actions={2} kpis={6} charts={2} />;
}
