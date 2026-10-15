import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTenantMatchingWeights, type MatchDemand } from "@/lib/matching";
import { MATCH_SHOW_MIN, scoreDemandMatches, transactionVariants } from "@/lib/match-candidates";
import { OPEN_DEMAND_STATUSES } from "@/lib/workflow-state";
import { groupBuyers, matchableUnits, type MatchableProject, type MatchableUnit, type ProjectBuyer } from "./unit-match";

export type BuyerDemand = MatchDemand & {
  customer: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

export type ProjectBuyerMatches = {
  buyers: ProjectBuyer<BuyerDemand>[];
  /** Taranan açık satın alma talebi sayısı (üst sınır uyarısı için). */
  scanned: number;
  truncated: boolean;
  reason: "ok" | "no_district" | "no_available_units";
};

const DEMAND_LIMIT = 300;

/**
 * Projenin müsait daireleri için uygun alıcılar (açık satın alma talepleri). Talepler projenin İLİNE ve satış işlem
 * türüne göre TEK sorguda daraltılır; skor bellekte, eşleşme motorunun kendi kuralıyla. İlçe seçilmemiş projede
 * eşleşme yapılmaz (Ankara'daki alıcıya İstanbul projesi önerilmesin).
 */
export async function loadProjectBuyerMatches(
  supabase: SupabaseClient,
  input: { tenantId: string; project: MatchableProject; units: readonly MatchableUnit[] },
): Promise<ProjectBuyerMatches> {
  if (!input.project.district_id || !input.project.province_id) return { buyers: [], scanned: 0, truncated: false, reason: "no_district" };
  const candidates = matchableUnits(input.project, input.units);
  if (candidates.length === 0) return { buyers: [], scanned: 0, truncated: false, reason: "no_available_units" };

  const [weights, { data, error }] = await Promise.all([
    fetchTenantMatchingWeights(supabase, input.tenantId),
    supabase
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(id, full_name)",
      )
      .eq("tenant_id", input.tenantId)
      .in("status", [...OPEN_DEMAND_STATUSES])
      .in("transaction_type", transactionVariants(["Satılık"]).variants)
      .or(`province_id.eq.${input.project.province_id},province_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(DEMAND_LIMIT),
  ]);
  if (error) {
    console.error("loadProjectBuyerMatches", { code: error.code });
    return { buyers: [], scanned: 0, truncated: false, reason: "ok" };
  }
  const demands = (data ?? []) as unknown as BuyerDemand[];
  const customerOf = (d: BuyerDemand) => {
    const c = Array.isArray(d.customer) ? d.customer[0] : d.customer;
    return c?.id ?? null;
  };
  const scored = scoreDemandMatches({
    demands,
    properties: candidates,
    weights: weights ?? null,
    customerOf,
    minScore: MATCH_SHOW_MIN,
  });
  return {
    buyers: groupBuyers(scored.pairs),
    scanned: demands.length,
    truncated: demands.length >= DEMAND_LIMIT,
    reason: "ok",
  };
}
