import type { SupabaseClient } from "@supabase/supabase-js";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { potentialLossAmount, POTENTIAL_LOSS_TYPES, type PotentialLossRow } from "@/lib/listing-control/potential-loss-core";

/**
 * "Potansiyel kayıp" TEK KAYNAK okuyucusu: listing_anomalies (`closure_loss` = kapanış formunda kaçan komisyon,
 * `potential_lost_deal` = portaldan kalkıp CRM'de işlemi olmayan ilan). Kayıp-Kaçak ekranı bunu okur; İlan Kontrol aynı
 * satırları uyarı kuyruğunda gösterir. Çağıranın oturumlu istemcisi (RLS: portals:view + lc_row_visible kapsamı).
 * `available:false` → migration (20261007000610) yok ya da okunamadı: çağıran eski kaynağa düşer (sahte sıfır yok).
 */
const READY_RPC = "lc_closure_loss_ready";
const LIMIT = 1000;

export async function loadPotentialLosses(
  db: SupabaseClient,
  opts: { fromIso?: string | null; toIso?: string | null; defaultRate?: number } = {},
): Promise<{ available: boolean; rows: PotentialLossRow[]; capped: boolean }> {
  if (rpcKnownMissing(READY_RPC)) return { available: false, rows: [], capped: false };
  const probe = await db.rpc(READY_RPC);
  recordRpcOutcome(READY_RPC, probe.error);
  if (probe.error || probe.data !== true) return { available: false, rows: [], capped: false };

  let q = db
    .from("listing_anomalies")
    .select("id, type, status, first_seen_at, property_id, details, property:properties!listing_anomalies_property_tenant_fkey(list_price, commission_rate)")
    .in("type", [...POTENTIAL_LOSS_TYPES])
    .neq("status", "false_positive")
    .order("first_seen_at", { ascending: false })
    .limit(LIMIT);
  if (opts.fromIso) q = q.gte("first_seen_at", opts.fromIso);
  if (opts.toIso) q = q.lte("first_seen_at", opts.toIso);
  const { data, error } = await q;
  if (error) {
    console.error("loadPotentialLosses", { code: error.code });
    return { available: false, rows: [], capped: false };
  }
  type Raw = { id: string; type: string; status: string; first_seen_at: string; property_id: string; details: Record<string, unknown> | null; property: { list_price: number | null; commission_rate: number | null } | { list_price: number | null; commission_rate: number | null }[] | null };
  const rows = ((data ?? []) as Raw[]).map((r) => {
    const p = Array.isArray(r.property) ? r.property[0] : r.property;
    return {
      id: r.id,
      type: r.type,
      at: r.first_seen_at,
      propertyId: r.property_id,
      amount: potentialLossAmount(r.type, r.details, { listPrice: p?.list_price ?? null, commissionRate: p?.commission_rate ?? null, defaultRate: opts.defaultRate }),
    };
  });
  return { available: true, rows, capped: rows.length >= LIMIT };
}
