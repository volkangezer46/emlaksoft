import { ListPageSkeleton } from "@/components/ui/list-page-skeleton";

/** Kasam: başlık + hesap kartları + hareket listesi iskeleti (B021). */
export default function Loading() {
  return <ListPageSkeleton label="Kasam yükleniyor" actions={1} kpis={0} toolbar body="table" rows={6} />;
}
