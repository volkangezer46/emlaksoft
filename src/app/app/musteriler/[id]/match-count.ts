import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMatchCandidateProperties } from "@/lib/match-candidates";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand } from "@/lib/matching";

/** Talepler > Eşleşme sekmesi ve form önizlemesiyle AYNI eşik (skor ≥ 35, elenmeyen). */
export const MATCH_SCORE_THRESHOLD = 35;

export type CustomerMatchCount = { count: number; truncated: boolean } | null;

/**
 * Müşterinin açık taleplerine GERÇEKTEN uyan portföy sayısı (CRM-G2). "En yeni 100 portföy" değil:
 * aday havuzu Talepler > Eşleşme ile aynı sorgudan (fetchMatchCandidateProperties: il + işlem türü daraltması),
 * skor aynı skorlayıcıdan (scoreDemandProperty + ofis ağırlıkları) gelir; bir portföy birden çok talebe uysa da
 * bir kez sayılır. Sorgu hatasında `null` (sayı uydurulmaz, öneri gösterilmez).
 */
export async function countCustomerMatches(
  supabase: SupabaseClient,
  tenantId: string | null,
  demands: MatchDemand[],
): Promise<CustomerMatchCount> {
  if (demands.length === 0) return { count: 0, truncated: false };
  const [candidates, weights] = await Promise.all([
    fetchMatchCandidateProperties(supabase, { demands, tenantId: tenantId ?? undefined }),
    fetchTenantMatchingWeights(supabase, tenantId ?? undefined),
  ]);
  if (candidates.error) return null;
  return { count: countMatchingProperties(demands, candidates.properties, weights), truncated: candidates.truncated };
}

/** SAF: eşiği geçen ve elenmeyen (talep, portföy) çiftlerindeki tekil portföy sayısı. */
export function countMatchingProperties(
  demands: MatchDemand[],
  properties: Parameters<typeof scoreDemandProperty>[1][],
  weights?: Parameters<typeof scoreDemandProperty>[2],
): number {
  const ids = new Set<string>();
  for (const p of properties) {
    for (const d of demands) {
      const r = scoreDemandProperty(d, p, weights);
      if (!r.eliminated && r.score >= MATCH_SCORE_THRESHOLD) {
        ids.add(p.id);
        break;
      }
    }
  }
  return ids.size;
}
