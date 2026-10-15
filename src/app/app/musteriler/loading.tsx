import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Müşteriler: liste hero (İçe aktar + Yeni müşteri) → 5 KPI → 2 grafik → araç çubuğu → tablo (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Müşteriler yükleniyor" actions={2} kpis={5} charts={2} rows={10} />;
}
