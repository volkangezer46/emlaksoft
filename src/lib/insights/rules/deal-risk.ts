import { computeDealScore } from "@/lib/deal-score";
import { buildDedupeKey, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { capPerUser, dayMs, MAX_PER_RECIPIENT_PER_RULE, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: deal_risk — kaybedilecek (hareketsiz, düşük puanlı) açık anlaşmalar.
 *
 * Formül KOPYALANMAZ: `computeDealScore` (deal-score.ts) yeniden kullanılır. Olgu: `insight_stalled_deals` RPC'si.
 * Yalnız sistem puanı "Düşük" (<35) VE hareketsizlik eşiği aşılmışsa içgörü üretilir. Puan bir TAHMİNDİR
 * (kural tabanlı, istatistiksel model değil): is_forecast=true, güven düşük.
 */

export const DEAL_RISK_RULE_ID = "deal_risk@1";
export const DEAL_MIN_IDLE_DAYS = 14;
export const DEAL_HIGH_IDLE_DAYS = 45;

export type StalledDealFact = {
  dealId: string;
  assignedTo: string;
  stage: string;
  createdAt: string;
  updatedAt: string | null;
  idleDays: number;
  offerCount: number;
  acceptedOffer: boolean;
  openTaskCount: number;
  appointmentCount: number;
  dealValue: number | null;
  listPrice: number | null;
  propertyTitle: string | null;
  propertyCode: string | null;
};

const STAGE_TR: Record<string, string> = { new: "Yeni", qualified: "Nitelikli", negotiation: "Müzakere" };

export function evaluateDealRisk(facts: readonly StalledDealFact[], nowMs: number): InsightDraft[] {
  const week = weekPeriod(nowMs);
  const drafts: (InsightDraft & { _idle: number })[] = [];
  for (const f of facts) {
    if (!f.assignedTo || f.idleDays < DEAL_MIN_IDLE_DAYS) continue;
    const score = computeDealScore(
      {
        stage: f.stage,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        offerCount: f.offerCount,
        hasAcceptedOffer: f.acceptedOffer,
        appointmentCount: f.appointmentCount,
        openTaskCount: f.openTaskCount,
        dealValue: f.dealValue,
        listPrice: f.listPrice,
      },
      nowMs,
    );
    if (score.tier !== "low") continue;
    const stageLabel = STAGE_TR[f.stage] ?? f.stage;
    const target = nameOr(f.propertyTitle ?? f.propertyCode, "Anlaşma");
    const negatives = score.factors
      .filter((x) => x.points < 0)
      .sort((a, b) => a.points - b.points)
      .slice(0, 2)
      .map((x) => x.label);
    drafts.push({
      kind: "deal_risk",
      ruleId: DEAL_RISK_RULE_ID,
      severity: f.idleDays >= DEAL_HIGH_IDLE_DAYS ? "yuksek" : "orta",
      title: `${target}: anlaşma ${f.idleDays} gündür hareketsiz`,
      why:
        `${stageLabel} aşamasında, ${f.offerCount} teklif ve ${f.openTaskCount} açık takip görevi var; sistem tahmini kapanma olasılığı %${score.score} (düşük).` +
        (negatives.length ? ` Öne çıkanlar: ${negatives.join(", ")}.` : ""),
      evidence: [
        { label: "Aşama", value: stageLabel },
        { label: "Hareketsiz", value: `${f.idleDays} gün` },
        { label: "Teklif", value: String(f.offerCount) },
        { label: "Sistem tahmini", value: `%${score.score}` },
      ],
      href: `/app/anlasmalar/${f.dealId}`,
      entityType: "deal",
      entityId: f.dealId,
      isForecast: true,
      confidence: "dusuk",
      dedupeKey: buildDedupeKey("deal", f.dealId, week),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: f.dealValue && f.dealValue > 0 ? Math.min(10, Math.round(Math.log10(f.dealValue) - 3)) : 0,
      _idle: f.idleDays,
    });
  }
  return capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._idle - a._idle).map(({ _idle, ...d }) => {
    void _idle;
    return d;
  });
}
