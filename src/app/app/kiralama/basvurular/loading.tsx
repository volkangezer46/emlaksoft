import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Kiracı başvuruları: başlık → 4 KPI → bağlantılar → liste. */
export default function Loading() {
  return <ListPageSkeleton label="Kiracı başvuruları yükleniyor" actions={1} kpis={4} charts={0} />;
}
