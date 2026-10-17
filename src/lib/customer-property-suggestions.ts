import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMatchCandidateProperties } from "@/lib/match-candidates";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand } from "@/lib/matching";
import { MATCH_SCORE_THRESHOLD } from "@/app/app/musteriler/[id]/match-count";
import { OPEN_DEAL_STAGES } from "@/lib/workflow-state";
import { getStageLabels } from "@/lib/definitions";
import { stageName } from "@/lib/deal-stage-labels";
import {
  autoSelectPropertyId,
  rankPropertySuggestions,
  type PropertySuggestion,
  type PropertySuggestionInput,
  type SuggestionDeal,
  type SuggestionMatch,
  type SuggestionOffer,
} from "@/lib/property-suggestions";

/** Açık anlaşmalar (müşteri adayı için tutar uyarısında da kullanılır). */
export type CustomerOpenDeal = { id: string; stage: string; stageLabel: string; value: number | null; propertyId: string | null; propertyLabel: string | null };

export type CustomerPropertyContext = {
  suggestions: PropertySuggestion[];
  autoPropertyId: string | null;
  openDeals: CustomerOpenDeal[];
};

type PropRef = { property_code?: string | null; title?: string | null } | null;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const label = (p: PropRef, fallback: string) => (p?.title || p?.property_code || fallback).trim();

/**
 * Müşterinin bağlamından portföy önerileri (RLS'li istemci: kullanıcı ne görebiliyorsa). Sorgu hatası öneriyi boş bırakır
 * (uydurma yok); eşleşme yalnız açık talep varsa hesaplanır (Talepler > Eşleşme ile aynı skorlayıcı ve eşik).
 */
export async function loadCustomerPropertyContext(
  supabase: SupabaseClient,
  tenantId: string | null,
  customerId: string,
  opts: { preferDealId?: string | null; withMatches?: boolean } = {},
): Promise<CustomerPropertyContext> {
  const [dealsRes, offersRes, demandsRes, stageLabels] = await Promise.all([
    supabase
      .from("deals")
      .select("id, stage, deal_value, property_id, updated_at, property:properties!deals_property_id_fkey(property_code, title)")
      .eq("customer_id", customerId)
      .in("stage", [...OPEN_DEAL_STAGES])
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("offers")
      .select("id, status, amount, property_id, created_at, property:properties!offers_property_id_fkey(property_code, title)")
      .eq("customer_id", customerId)
      .in("status", ["draft", "submitted", "countered"])
      .order("created_at", { ascending: false })
      .limit(10),
    opts.withMatches === false
      ? Promise.resolve({ data: [] as unknown[] })
      : supabase
          .from("customer_demands")
          .select("id, transaction_type, property_type, budget_min, budget_max, rooms, min_sqm, urgency, status, province_id, district_id, neighborhood_id, criteria")
          .eq("customer_id", customerId)
          .in("status", ["new", "active"])
          .limit(10),
    getStageLabels(),
  ]);

  const openDeals: CustomerOpenDeal[] = ((dealsRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
    id: String(d.id),
    stage: String(d.stage),
    stageLabel: stageName(stageLabels, String(d.stage)),
    value: d.deal_value != null ? Number(d.deal_value) : null,
    propertyId: (d.property_id as string | null) ?? null,
    propertyLabel: d.property_id ? label(one(d.property as PropRef | PropRef[]), "Portföy") : null,
  }));
  const deals: SuggestionDeal[] = ((dealsRes.data ?? []) as Record<string, unknown>[])
    .filter((d) => d.property_id)
    .map((d) => ({
      dealId: String(d.id),
      propertyId: String(d.property_id),
      label: label(one(d.property as PropRef | PropRef[]), "Portföy"),
      stage: String(d.stage),
      stageLabel: stageName(stageLabels, String(d.stage)),
      value: d.deal_value != null ? Number(d.deal_value) : null,
      updatedAt: String(d.updated_at ?? ""),
    }));
  const offers: SuggestionOffer[] = ((offersRes.data ?? []) as Record<string, unknown>[])
    .filter((o) => o.property_id)
    .map((o) => ({
      propertyId: String(o.property_id),
      label: label(one(o.property as PropRef | PropRef[]), "Portföy"),
      status: String(o.status),
      amount: o.amount != null ? Number(o.amount) : null,
      createdAt: String(o.created_at ?? ""),
    }));

  let matches: SuggestionMatch[] = [];
  const demands = ((demandsRes.data ?? []) as Record<string, unknown>[]).map(
    (d): MatchDemand => ({
      id: String(d.id),
      transaction_type: String(d.transaction_type ?? ""),
      property_type: (d.property_type as string | null) ?? null,
      province_id: (d.province_id as string | null) ?? null,
      district_id: (d.district_id as string | null) ?? null,
      neighborhood_id: (d.neighborhood_id as string | null) ?? null,
      budget_min: d.budget_min != null ? Number(d.budget_min) : null,
      budget_max: d.budget_max != null ? Number(d.budget_max) : null,
      rooms: (d.rooms as string | null) ?? null,
      min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null,
      urgency: (d.urgency as string | null) ?? null,
      status: String(d.status),
      criteria: d.criteria,
    }),
  );
  if (demands.length > 0) {
    const [candidates, weights] = await Promise.all([
      fetchMatchCandidateProperties(supabase, { demands, tenantId: tenantId ?? undefined }),
      fetchTenantMatchingWeights(supabase, tenantId ?? undefined),
    ]);
    if (!candidates.error) {
      for (const p of candidates.properties) {
        let best = -1;
        for (const d of demands) {
          const r = scoreDemandProperty(d, p, weights);
          if (!r.eliminated && r.score >= MATCH_SCORE_THRESHOLD && r.score > best) best = r.score;
        }
        if (best >= 0) matches.push({ propertyId: p.id, label: (p.title || p.property_code || "Portföy").trim(), score: best });
      }
      matches = matches.sort((a, b) => b.score - a.score).slice(0, 20);
    }
  }

  const input: PropertySuggestionInput = { deals, offers, matches, preferDealId: opts.preferDealId ?? null };
  return { suggestions: rankPropertySuggestions(input), autoPropertyId: autoSelectPropertyId(input), openDeals };
}
