import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Muhasebe: liste hero (eylemler) → sayfa içi sekme şeridi → sekme gövdesi (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Muhasebe yükleniyor" actions={2} kpis={0} tabs toolbar={false} body="panel" />;
}
