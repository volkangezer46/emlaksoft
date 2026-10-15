import { computeDealScore } from "@/lib/customer-state/deal";
import { DEAL_HIGH_IDLE_DAYS, DEAL_MIN_IDLE_DAYS } from "@/lib/customer-state/thresholds";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";
import { buildDedupeKey, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft, InsightRuleRun } from "@/lib/insights/types";
import { capPerUser, liveIdsOf, dayMs, MAX_PER_RECIPIENT_PER_RULE, nameOr } from "@/lib/insights/rules/common";

/**
 * Kural: deal_risk — kaybedilecek (hareketsiz, düşük puanlı) açık anlaşmalar.
 *
 * Hareketsizlik AŞAMADA GEÇEN GÜNDÜR (SP1 `deals.stage_changed_at`; anlaşma listesi `?bayat=1` ve ana ekranla aynı ölçü):
 * not eklemek ya da alan düzenlemek anlaşmayı "taze" yapmaz. Eski satırda (aşama geçmişi yoksa) son güncelleme vekildir.
 * Beklenen kapanış tarihi (`expected_close_date`) geçmiş açık anlaşma da adaydır: puan "yüksek" değilse kart çıkar.
 *
 * Formül KOPYALANMAZ: `computeDealScore` (deal-score.ts) yeniden kullanılır. Olgu: `insight_stalled_deals` RPC'si.
 * Yalnız sistem puanı "Düşük" (<35) VE hareketsizlik eşiği aşılmışsa içgörü üretilir. Puan bir TAHMİNDİR
 * (kural tabanlı, istatistiksel model değil): is_forecast=true, güven düşük.
 */

export const DEAL_RISK_RULE_ID = "deal_risk@1";
export { DEAL_MIN_IDLE_DAYS, DEAL_HIGH_IDLE_DAYS };

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
  /** SP1: aşamaya giriş anı (yoksa null → `updatedAt` vekil). */
  stageChangedAt?: string | null;
  /** SP1: beklenen kapanış günü "YYYY-AA-GG". */
  expectedCloseDate?: string | null;
  /** Beklenen kapanıştan bu yana geçen gün (TR günü; geçmediyse 0). */
  closeOverdueDays?: number;
};

// Aşama adları tek kaynaktan (definition-defaults / deal-stage-labels); sabit metin yazılmaz.
const STAGE_TR = stageLabelMap(defaultStageLabels());

/** `minIdleDays`: ofis tanımı (office.alert.deal_stale_days); verilmezse DEAL_MIN_IDLE_DAYS. */
export function evaluateDealRiskRun(facts: readonly StalledDealFact[], nowMs: number, minIdleDays: number = DEAL_MIN_IDLE_DAYS): InsightRuleRun {
  const week = weekPeriod(nowMs);
  const drafts: (InsightDraft & { _idle: number })[] = [];
  for (const f of facts) {
    const overdue = Math.max(0, f.closeOverdueDays ?? 0);
    const idle = f.idleDays >= minIdleDays;
    if (!f.assignedTo || (!idle && overdue === 0)) continue;
    const score = computeDealScore(
      {
        stage: f.stage,
        createdAt: f.createdAt,
        // Puanın hareketsizlik bileşeni de aşamada geçen günden (aynı ölçü).
        updatedAt: f.stageChangedAt ?? f.updatedAt,
        offerCount: f.offerCount,
        hasAcceptedOffer: f.acceptedOffer,
        appointmentCount: f.appointmentCount,
        openTaskCount: f.openTaskCount,
        dealValue: f.dealValue,
        listPrice: f.listPrice,
      },
      nowMs,
    );
    // Hareketsiz anlaşmada yalnız düşük puan; kapanışı gecikmişte puan "yüksek" değilse.
    const risky = (idle && score.tier === "low") || (overdue > 0 && score.tier !== "high");
    if (!risky) continue;
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
      severity: (idle && f.idleDays >= DEAL_HIGH_IDLE_DAYS) || overdue >= DEAL_HIGH_IDLE_DAYS ? "yuksek" : "orta",
      title:
        overdue > 0 && !(idle && score.tier === "low")
          ? `${target}: beklenen kapanış ${overdue} gün geçti`
          : `${target}: anlaşma ${f.idleDays} gündür aynı aşamada`,
      why:
        `${stageLabel} aşamasında ${f.idleDays} gündür; ${f.offerCount} teklif ve ${f.openTaskCount} açık takip görevi var; sistem tahmini kapanma olasılığı %${score.score}${score.tier === "low" ? " (düşük)" : ""}.` +
        (overdue > 0 && f.expectedCloseDate ? ` Beklenen kapanış (${f.expectedCloseDate}) ${overdue} gün geçti: tarihi güncelleyin ya da sonraki adımı planlayın.` : "") +
        (negatives.length ? ` Öne çıkanlar: ${negatives.join(", ")}.` : ""),
      evidence: [
        { label: "Aşama", value: stageLabel },
        { label: "Aşamada", value: `${f.idleDays} gün` },
        ...(overdue > 0 && f.expectedCloseDate ? [{ label: "Beklenen kapanış", value: `${f.expectedCloseDate} (${overdue} gün geçti)` }] : []),
        { label: "Teklif", value: String(f.offerCount) },
        { label: "Sistem tahmini", value: `%${score.score}` },
      ],
      href: `/app/anlasmalar/${f.dealId}`,
      entityType: "deal",
      entityId: f.dealId,
      isForecast: true,
      confidence: "dusuk",
      // Dedupe dönemi BİLİNÇLİ olarak hafta (gün dilimi EKLENMEDİ): gün eklemek aynı hareketsiz anlaşma için her gün yeni satır
      // (spam + kullanıcı başı 15 sınırının dolması) doğurur; ayrıca anahtar biçimi değişince bu haftanın mevcut açık satırlarıyla
      // eşleşmez ve aynı anlaşma iki kez görünürdü. Koşul kalkınca satır ARGE-1 kapatmasıyla zaten biter.
      dedupeKey: buildDedupeKey("deal", f.dealId, week),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "user", userId: f.assignedTo },
      urgencyDays: null,
      impact: f.dealValue && f.dealValue > 0 ? Math.min(10, Math.round(Math.log10(f.dealValue) - 3)) : 0,
      _idle: Math.max(f.idleDays, overdue),
    });
  }
  const liveEntityIds = liveIdsOf(drafts);
  const capped = capPerUser(drafts, MAX_PER_RECIPIENT_PER_RULE, (a, b) => b._idle - a._idle).map(({ _idle, ...d }) => {
    void _idle;
    return d;
  });
  return { drafts: capped, liveEntityIds };
}

export function evaluateDealRisk(facts: readonly StalledDealFact[], nowMs: number, minIdleDays: number = DEAL_MIN_IDLE_DAYS): InsightDraft[] {
  return evaluateDealRiskRun(facts, nowMs, minIdleDays).drafts;
}
