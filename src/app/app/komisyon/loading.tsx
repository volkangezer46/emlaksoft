import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Komisyon: liste hero (Onaylar) → 3 KPI → tahmin kartı → defter tablosu (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Komisyon yükleniyor" actions={1} kpis={3} charts={1} toolbar={false} rows={7} />;
}
