import { buildDedupeKey, monthPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { capPerUser, liveIdsOf, dayMs, MAX_PER_RECIPIENT_PER_RULE, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: price_action — uzun süredir yayında VE benzer aktif ilanların medyanından belirgin pahalı portföyler.
 *
 * Kaynak: `insight_stale_listings` RPC'si (aynı ilçe + tür + işlem tipindeki DİĞER yayın ilanlarının liste fiyatı
 * medyanı). EMSAL YOKSA ÜRETİLMEZ (peerMedian null veya peerCount < MIN_PEERS). Sabit il tablosu
 * (price-health referans modeli) bu kuralda KULLANILMAZ.
 * DÜRÜSTLÜK: emsal = aktif ilanların İSTENEN fiyatlarıdır (gerçekleşen satış değil); güven en çok "orta".
 */

export const PRICE_ACTION_RULE_ID = "price_action@1";
export const PRICE_MIN_DAYS = 30;
export const PRICE_MIN_PEERS = 5;
/** Medyanın bu oran üzerindeki liste fiyatı "pahalı" sayılır (%). */
export const PRICE_MIN_ABOVE_PCT = 8;
export const PRICE_HIGH_ABOVE_PCT = 20;
export const PRICE_HIGH_DAYS = 60;

export type StaleListingFact = {
  propertyId: string;
  assignedTo: string;
  propertyCode: string | null;
  title: string | null;
  listPrice: number;
  daysListed: number;
  peerCount: number;
  peerMedian: number | null;
  /** Mülk sahibinden onay bekleyen bir fiyat revizyonu önerisi var (property_price_proposals, 20261012000800). */
  pendingProposal?: boolean;
};

/** `minDays`: ofis tanımı (office.insight.listing_stale_days); verilmezse PRICE_MIN_DAYS. */
export function evaluatePriceActionRun(facts: readonly StaleListingFact[], nowMs: number, minDays: number = PRICE_MIN_DAYS): InsightRuleRun {
  const month = monthPeriod(nowMs);
  const drafts: (InsightDraft & { _days: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.daysListed < minDays) continue;
    // Emsal yoksa üretme.
    if (f.peerMedian === null || !(f.peerMedian > 0) || f.peerCount < PRICE_MIN_PEERS) continue;
    if (!(f.listPrice > 0)) continue;
    const abovePct = Math.round(((f.listPrice - f.peerMedian) / f.peerMedian) * 100);
    if (abovePct < PRICE_MIN_ABOVE_PCT) continue;
    const high = abovePct >= PRICE_HIGH_ABOVE_PCT && f.daysListed >= PRICE_HIGH_DAYS;
    const name = nameOr(f.title ?? f.propertyCode, "İlan");
    drafts.push({
      kind: "price_action",
      ruleId: PRICE_ACTION_RULE_ID,
      severity: high ? "yuksek" : "orta",
      title: f.pendingProposal ? `Fiyat önerisi onay bekliyor: ${name}` : `Fiyatı gözden geçir: ${name}`,
      why:
        `${f.daysListed} gündür yayında ve liste fiyatı benzer ${f.peerCount} aktif ilanın medyanının %${abovePct} üzerinde. ` +
        `Karşılaştırma aktif ilanların istenen fiyatlarıdır (gerçekleşen satış değil).` +
        (f.pendingProposal ? " Mülk sahibine fiyat revizyonu önerisi gönderildi; yanıtı bekleniyor." : ""),
      evidence: [
        { label: "Yayında", value: `${f.daysListed} gün` },
        { label: "Medyanın üstünde", value: `%${abovePct}` },
        { label: "Emsal ilan", value: `${f.peerCount} aktif ilan` },
        { label: "Kaynak", value: "aktif ilan emsali" },
        ...(f.pendingProposal ? [{ label: "Fiyat önerisi", value: "mülk sahibi onayı bekliyor" }] : []),
      ],
      href: `/app/portfoyler/${f.propertyId}`,
      entityType: "property",
      entityId: f.propertyId,
      isForecast: false,
      confidence: f.peerCount >= 10 ? "orta" : "dusuk",
      dedupeKey: buildDedupeKey("price", f.propertyId, month),
      validUntilMs: nowMs + dayMs(14),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: Math.min(10, Math.round(abovePct / 5)),
      _days: f.daysListed,
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  const capped = capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._days - a._days).map(({ _days, ...d }) => {
    void _days;
    return d;
  });
  return { drafts: capped, liveEntityIds };
}

export function evaluatePriceAction(facts: readonly StaleListingFact[], nowMs: number, minDays: number = PRICE_MIN_DAYS): InsightDraft[] {
  return evaluatePriceActionRun(facts, nowMs, minDays).drafts;
}
