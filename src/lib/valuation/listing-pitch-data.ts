import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso } from "@/lib/clock";
import { transactionVariants } from "@/lib/match-candidates";
import { getPortalMemberships } from "@/lib/portals/membership";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";
import { buildPitchCards, type PitchCard, type PitchDeal } from "./listing-pitch";

/**
 * PF-03 sunum kartlarının VERİ okuması (oturum istemcisi, RLS). Yalnız toplu sayı üretir; örnek (is_sample) kayıtlar
 * sayılmaz. İlçe verilmezse ofis geneli kullanılır (kart notu "Bölgede" yerine ofis geneli der).
 */
export async function loadListingPitch(
  supabase: SupabaseClient,
  input: { tenantId: string; districtId: string | null; areaLabel: string | null },
): Promise<{ cards: PitchCard[]; portals: string[] }> {
  const since = daysAgoIso(365);
  let dealsQuery = supabase
    .from("deals")
    .select("deal_value, closed_at, updated_at, property:properties!deals_property_id_fkey!inner(district_id, list_price, created_at)")
    .eq("tenant_id", input.tenantId)
    .eq("stage", "won")
    .eq("deal_type", "sale")
    .eq("is_sample", false)
    .gte("updated_at", since)
    .limit(500);
  if (input.districtId) dealsQuery = dealsQuery.eq("property.district_id", input.districtId);

  let demandsQuery = supabase
    .from("customer_demands")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .in("status", [...OPEN_DEMAND_STATUSES])
    .in("transaction_type", transactionVariants(["Satılık"]).variants)
    .eq("is_sample", false);
  if (input.districtId) demandsQuery = demandsQuery.eq("district_id", input.districtId);

  const [dealsRes, demandsRes, portals] = await Promise.all([
    dealsQuery,
    demandsQuery,
    getPortalMemberships(input.tenantId).catch(() => []),
  ]);
  if (dealsRes.error) console.error("loadListingPitch deals", { code: dealsRes.error.code });
  if (demandsRes.error) console.error("loadListingPitch demands", { code: demandsRes.error.code });

  type Row = {
    deal_value: number | string | null;
    closed_at: string | null;
    updated_at: string;
    property: { list_price: number | string | null; created_at: string | null } | Array<{ list_price: number | string | null; created_at: string | null }> | null;
  };
  const deals: PitchDeal[] = ((dealsRes.data ?? []) as Row[]).map((d) => {
    const p = Array.isArray(d.property) ? d.property[0] ?? null : d.property;
    const closed = d.closed_at ?? d.updated_at;
    const listed = p?.created_at ?? null;
    const days = closed && listed ? Math.round((Date.parse(closed) - Date.parse(listed)) / 86_400_000) : null;
    return {
      salePrice: d.deal_value != null ? Number(d.deal_value) : null,
      listPrice: p?.list_price != null ? Number(p.list_price) : null,
      daysOnMarket: days,
    };
  });

  const cards = buildPitchCards({
    areaLabel: input.districtId ? input.areaLabel : null,
    deals,
    openBuyerDemands: demandsRes.error ? 0 : demandsRes.count ?? 0,
  });
  const portalNames = portals.filter((m) => m.effective === "active").map((m) => m.label);
  return { cards, portals: portalNames };
}
