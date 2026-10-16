import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Portföy dağıtımı: liste hero → özet şerit → havuz satırları (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Portföy dağıtımı yükleniyor" actions={1} kpis={4} toolbar={false} />;
}
