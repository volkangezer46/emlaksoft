import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { effectiveStatus, parseSnapshot, type ProposalStatus } from "@/lib/price-proposals/model";
import { PriceProposalPanel, type ProposalView } from "./price-proposal-panel";

type Row = {
  id: string;
  status: ProposalStatus;
  old_price: number | string;
  new_price: number | string;
  reason: string;
  owner_note: string | null;
  comparables_snapshot: unknown;
  expires_at: string;
  decided_at: string | null;
  created_at: string;
};

/**
 * Portföy detayı "Fiyat" sekmesi: fiyat revizyonu önerisi. Son 3 öneri (RLS: properties:view). Tablo yoksa
 * (migration uygulanmadı) bölüm gizlenir. Yalnız okuma; yazma server action + RPC.
 */
export async function PriceProposalSection({ propertyId, tenantId, canEdit }: { propertyId: string; tenantId: string | null; canEdit: boolean }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_price_proposals")
    .select("id, status, old_price, new_price, reason, owner_note, comparables_snapshot, expires_at, decided_at, created_at")
    .eq("property_id", propertyId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) return null;

  const nowMs = now();
  const items: ProposalView[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    status: effectiveStatus(r.status, Date.parse(r.expires_at), nowMs),
    oldPrice: Number(r.old_price),
    newPrice: Number(r.new_price),
    reason: r.reason,
    ownerNote: r.owner_note,
    snapshot: parseSnapshot(r.comparables_snapshot),
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  }));
  return <PriceProposalPanel propertyId={propertyId} canEdit={canEdit} items={items} />;
}
