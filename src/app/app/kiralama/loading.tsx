import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Mülk yönetimi (kiralama): liste hero → 5 KPI → 2 dağılım grafiği → araç çubuğu → liste (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Mülk yönetimi yükleniyor" actions={2} kpis={5} charts={2} />;
}
