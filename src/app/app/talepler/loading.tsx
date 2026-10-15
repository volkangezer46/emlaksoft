import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Talepler: liste hero (Eşleşme + Yeni talep) → 5 KPI → 2 grafik → araç çubuğu → tablo (gerçek ListPage düzeni; B023). */
export default function Loading() {
  return <ListPageSkeleton label="Talepler yükleniyor" actions={2} kpis={5} charts={2} />;
}
