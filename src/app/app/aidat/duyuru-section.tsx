import type { SupabaseClient } from "@supabase/supabase-js";
import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { loadBuildingAnnouncements } from "@/lib/building-management/announcements";
import { AnnouncementComposer, AnnouncementItem } from "./duyuru-panel";

/** "Duyurular" bölümü (sunucu): yeni duyuru formu + yayımlanmış duyurular (sabitlenenler önce). */
export async function AnnouncementsSection({
  db,
  tenantId,
  buildingId,
  perms,
}: {
  db: SupabaseClient;
  tenantId: string;
  buildingId: string;
  perms: { canCreate: boolean; canEdit: boolean };
}) {
  const { available, rows } = await loadBuildingAnnouncements(db, { tenantId, buildingId });
  if (!available) {
    return <EmptyState icon={Megaphone} title="Duyurular kurulum bekliyor" description="Veritabanı güncellemesi henüz uygulanmamış olabilir; sistem yöneticinize bildirin." />;
  }
  return (
    <div className="space-y-4">
      {perms.canCreate ? <AnnouncementComposer buildingId={buildingId} /> : null}
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={Megaphone}
          title="Henüz duyuru yok"
          description="Su kesintisi, asansör bakımı, genel kurul daveti ya da aidat bilgilendirmesi gibi duyurular sakinlerin portalında görünür."
        />
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]" aria-label="Duyurular">
          {rows.map((r) => <AnnouncementItem key={r.id} row={r} canEdit={perms.canEdit} />)}
        </ul>
      )}
    </div>
  );
}
