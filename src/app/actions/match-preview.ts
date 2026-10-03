"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import {
  encodeDemandPreviewParam,
  parseDemandValues,
  sanitizeDemandValues,
} from "@/lib/demand-criteria";
import { fetchMatchCandidateProperties } from "@/lib/match-candidates";
import { fetchTenantMatchingWeights, scoreDemandProperty, tierOf, type MatchDemand } from "@/lib/matching";

export type MatchPreviewItem = {
  id: string;
  code: string;
  title: string;
  score: number;
  tier: "strong" | "good" | "weak" | "none";
};

export type MatchPreviewResult =
  | { ok: true; count: number; top: MatchPreviewItem[]; href: string; scanned: number }
  | { ok: false; error: string };

/**
 * Formdaki (henüz kaydedilmemiş) talebin canlı eşleşme önizlemesi — SALT OKUNUR.
 * `/app/eslestirme` ile aynı parse (parseDemandValues), aynı aday sorgusu
 * (fetchMatchCandidateProperties), aynı skorlayıcı ve aynı eşik (skor >= 35, elenmeyen):
 * sayı bağlantıdaki sayfayla tutar. Hiçbir kayıt yazılmaz.
 */
export async function previewDemandMatches(input: unknown): Promise<MatchPreviewResult> {
  const gate = await requirePermission("matching", "view");
  if (!gate.ok) return { ok: false, error: gate.error };

  const values = sanitizeDemandValues(input);
  if (!values) return { ok: false, error: "Geçersiz istek." };
  const parsed = parseDemandValues(values);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const demand: MatchDemand = {
    id: "onizleme",
    ...parsed.columns,
    status: "active",
    criteria: parsed.criteria,
  };

  const [properties, weights] = await Promise.all([
    fetchMatchCandidateProperties(supabase, { demands: [demand], tenantId: gate.tenantId }),
    fetchTenantMatchingWeights(supabase, gate.tenantId),
  ]);

  const scored = properties
    .map((p) => ({ p, r: scoreDemandProperty(demand, p, weights) }))
    .filter(({ r }) => !r.eliminated && r.score >= 35)
    .sort((a, b) => b.r.score - a.r.score);

  return {
    ok: true,
    count: scored.length,
    scanned: properties.length,
    top: scored.slice(0, 3).map(({ p, r }) => ({
      id: p.id,
      code: p.property_code,
      title: p.title ?? p.property_code,
      score: r.score,
      tier: tierOf(r.score),
    })),
    href: `/app/eslestirme?kriter=${encodeURIComponent(encodeDemandPreviewParam(values))}`,
  };
}
