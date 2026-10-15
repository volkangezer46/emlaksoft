import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Havuz ve atama: liste hero → özet şerit → havuz satırları (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Havuz ve atama yükleniyor" actions={1} kpis={4} toolbar={false} />;
}
