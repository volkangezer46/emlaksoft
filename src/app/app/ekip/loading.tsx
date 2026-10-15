import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Ekibim: liste hero → KPI kartları → ekip panelleri (gerçek ListPage düzeni; B021). */
export default function Loading() {
  return <ListPageSkeleton label="Ekibim yükleniyor" actions={1} kpis={3} toolbar={false} body="panel" />;
}
