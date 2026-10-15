import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Görevler: liste hero (Yeni görev) → 5 KPI → 2 grafik → araç çubuğu → liste (gerçek ListPage düzeni; B023). */
export default function Loading() {
  return <ListPageSkeleton label="Görevler yükleniyor" actions={1} kpis={5} charts={2} />;
}
