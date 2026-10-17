import { formatTryAmount } from "@/lib/format";

/**
 * "Önerilen" portföyler (WP2) — SAF sıralama. Randevu ve anlaşma formu müşterinin bildiğimiz bağlamını öne alır:
 * açık anlaşmasının portföyü, açık teklifinin portföyü ve taleplerine en çok uyan 5 portföy. Aynı portföy bir kez
 * (en güçlü kaynağıyla) görünür. Yalnız TEK aday anlaşma/teklif portföyü varsa (ya da ?deal= verildiyse) otomatik seçilir;
 * eşleşme tek başına otomatik seçim yapmaz (tahmin, bağlam değil).
 */

export type SuggestionDeal = { dealId: string; propertyId: string; label: string; stage: string; stageLabel: string; value: number | null; updatedAt: string };
export type SuggestionOffer = { propertyId: string; label: string; status: string; amount: number | null; createdAt: string };
export type SuggestionMatch = { propertyId: string; label: string; score: number };

export type PropertySuggestionInput = {
  deals: readonly SuggestionDeal[];
  offers: readonly SuggestionOffer[];
  matches: readonly SuggestionMatch[];
  /** ?deal= ile gelinen anlaşma: portföyü en üstte ve seçili. */
  preferDealId?: string | null;
};

export type PropertySuggestion = { propertyId: string; label: string; source: "deal" | "offer" | "match"; reason: string };

export const MATCH_SUGGESTION_LIMIT = 5;

const STAGE_RANK: Record<string, number> = { negotiation: 0, qualified: 1, new: 2 };
const OFFER_RANK: Record<string, number> = { countered: 0, submitted: 1, draft: 2 };
const OPEN_OFFER_STATUSES = new Set(Object.keys(OFFER_RANK));

function money(n: number | null): string | null {
  return n != null && Number.isFinite(n) && n > 0 ? formatTryAmount(n) : null;
}

function sortedDeals(input: PropertySuggestionInput): SuggestionDeal[] {
  return [...input.deals]
    .filter((d) => d.propertyId && d.stage in STAGE_RANK)
    .sort(
      (a, b) =>
        Number(b.dealId === input.preferDealId) - Number(a.dealId === input.preferDealId) ||
        STAGE_RANK[a.stage]! - STAGE_RANK[b.stage]! ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

function sortedOffers(input: PropertySuggestionInput): SuggestionOffer[] {
  return [...input.offers]
    .filter((o) => o.propertyId && OPEN_OFFER_STATUSES.has(o.status))
    .sort((a, b) => OFFER_RANK[a.status]! - OFFER_RANK[b.status]! || b.createdAt.localeCompare(a.createdAt));
}

export function rankPropertySuggestions(input: PropertySuggestionInput): PropertySuggestion[] {
  const out: PropertySuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: PropertySuggestion) => {
    if (seen.has(s.propertyId)) return;
    seen.add(s.propertyId);
    out.push(s);
  };
  for (const d of sortedDeals(input)) {
    push({ propertyId: d.propertyId, label: d.label, source: "deal", reason: ["Açık anlaşma", d.stageLabel, money(d.value)].filter(Boolean).join(" · ") });
  }
  for (const o of sortedOffers(input)) {
    push({ propertyId: o.propertyId, label: o.label, source: "offer", reason: ["Teklif", money(o.amount)].filter(Boolean).join(" · ") });
  }
  const matches = [...input.matches].filter((m) => m.propertyId).sort((a, b) => b.score - a.score);
  let added = 0;
  for (const m of matches) {
    if (added >= MATCH_SUGGESTION_LIMIT) break;
    if (seen.has(m.propertyId)) continue;
    push({ propertyId: m.propertyId, label: m.label, source: "match", reason: `Talebe uygun · ${Math.round(m.score)} puan` });
    added++;
  }
  return out;
}

/** Otomatik seçim: ?deal= verildiyse onun portföyü; değilse açık anlaşma + teklif portföyleri TEK ise o; aksi halde yok. */
export function autoSelectPropertyId(input: PropertySuggestionInput): string | null {
  const preferred = input.preferDealId ? input.deals.find((d) => d.dealId === input.preferDealId && d.propertyId) : null;
  if (preferred) return preferred.propertyId;
  const ids = new Set([...sortedDeals(input).map((d) => d.propertyId), ...sortedOffers(input).map((o) => o.propertyId)]);
  return ids.size === 1 ? [...ids][0]! : null;
}
