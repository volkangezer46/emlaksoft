import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Randevular: liste hero (takvim + Yeni randevu) → 6 KPI → 2 grafik → araç çubuğu → liste (gerçek ListPage düzeni; B023). */
export default function Loading() {
  return <ListPageSkeleton label="Randevular yükleniyor" actions={2} kpis={6} charts={2} />;
}
