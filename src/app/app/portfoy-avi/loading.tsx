import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Sahibinden ilanlar: liste hero → 5 KPI → araç çubuğu → ilan satırları (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Sahibinden ilanlar yükleniyor" actions={1} kpis={5} />;
}
