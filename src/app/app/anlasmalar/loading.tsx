import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Anlaşmalar: liste hero → KPI şeridi → aşama grafiği → araç çubuğu → liste (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Anlaşmalar yükleniyor" actions={2} kpis={5} charts={1} />;
}
