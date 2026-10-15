/**
 * HEDEF TEMPOSU (saf). Dönemin geçen payına göre beklenen ilerleme ile gerçekleşmeyi kıyaslar.
 *
 * Kural: dönemin en az %50'si geçmişken gerçekleşme, beklenen tempoya göre %70'in altındaysa "yavas".
 *   beklenen = hedef × geçen pay;   tempo oranı = gerçekleşme / beklenen.
 * Dönem başında (pay < %50) uyarı yok: erken dönem dalgalanması gürültü üretir.
 * Hedef 0 / tanımsız → "yok" (uyarı yok). Hedef tutturulduysa → "tamam" (dönem içinde de).
 * Dönem bittiyse ve hedef tutmadıysa → "bitti" (tempo uyarısı artık eyleme dönük değil).
 *
 * Zaman enjekte edilir (`nowMs`); dönem sınırları çağıranın hesabıdır (targetPeriodRange, TR takvimi).
 */

/** Uyarının devreye girdiği asgari geçen dönem payı (0–1). */
export const TARGET_PACE_MIN_ELAPSED = 0.5;
/** Beklenen tempoya göre bu oranın altı "yavaş" sayılır (0–1). */
export const TARGET_PACE_SLOW_RATIO = 0.7;

export type TargetPaceStatus = "yok" | "baslamadi" | "erken" | "yolunda" | "yavas" | "tamam" | "bitti";

export type TargetPace = {
  status: TargetPaceStatus;
  /** Dönemin geçen payı (0–1, sınırlı). */
  elapsedShare: number;
  /** Bu ana kadar beklenen gerçekleşme (hedef × geçen pay). */
  expected: number;
  /** Gerçekleşme / beklenen; beklenen 0 ise null. */
  paceRatio: number | null;
};

export function evaluateTargetPace(input: {
  actual: number;
  target: number;
  startMs: number;
  endMs: number;
  nowMs: number;
}): TargetPace {
  const actual = Number.isFinite(input.actual) ? Math.max(0, input.actual) : 0;
  const target = Number.isFinite(input.target) ? input.target : 0;
  const total = input.endMs - input.startMs;
  const rawShare = total > 0 ? (input.nowMs - input.startMs) / total : Number.NaN;
  const elapsedShare = Number.isFinite(rawShare) ? Math.max(0, Math.min(1, rawShare)) : 0;
  const expected = target > 0 ? target * elapsedShare : 0;
  const paceRatio = expected > 0 ? actual / expected : null;
  const base = { elapsedShare, expected, paceRatio };

  if (!(target > 0) || !(total > 0)) return { ...base, status: "yok" };
  if (actual >= target) return { ...base, status: "tamam" };
  if (input.nowMs < input.startMs) return { ...base, status: "baslamadi" };
  if (input.nowMs >= input.endMs) return { ...base, status: "bitti" };
  if (elapsedShare < TARGET_PACE_MIN_ELAPSED) return { ...base, status: "erken" };
  return { ...base, status: paceRatio !== null && paceRatio < TARGET_PACE_SLOW_RATIO ? "yavas" : "yolunda" };
}

/** Bir hedefin birden çok ölçütünden (anlaşma, gelir, randevu, portföy) temposu düşük olanların etiketleri. */
export function slowPaceLabels(
  metrics: readonly { label: string; actual: number; target: number }[],
  range: { start: number; end: number },
  nowMs: number,
): string[] {
  return metrics
    .filter((m) => evaluateTargetPace({ actual: m.actual, target: m.target, startMs: range.start, endMs: range.end, nowMs }).status === "yavas")
    .map((m) => m.label);
}

/* -------------------------------------------------------------------------------------------- */
/* OA5: boru hattı kapsaması (TAHMİN)                                                            */
/* -------------------------------------------------------------------------------------------- */

/** Olasılığı boş açık anlaşmada aşama varsayılanı (transition_deal_stage_atomic ile aynı: 20/40/60). */
export const STAGE_DEFAULT_PROBABILITY: Readonly<Record<string, number>> = { new: 20, qualified: 40, negotiation: 60 };

export type CoverageDeal = { value: number | null; probability: number | null; stage: string };

export type PipelineCoverage = {
  /** Olasılıkla ağırlıklı beklenen brüt komisyon (₺). */
  weightedCommission: number;
  /** Olasılıkla ağırlıklı beklenen anlaşma sayısı. */
  weightedDeals: number;
  /** Kalan gelir hedefini karşılama katı (ör. 1.4); kalan 0 ya da hedef yoksa null. */
  revenueCoverage: number | null;
  /** Kalan anlaşma hedefini karşılama katı; kalan 0 ya da hedef yoksa null. */
  dealCoverage: number | null;
  /** Hesaba giren açık anlaşma sayısı. */
  openCount: number;
};

/**
 * Kapsama = ağırlıklı açık hat ÷ kalan hedef. Olasılık boşsa aşama varsayılanı; o da yoksa anlaşma hesaba girmez.
 * Tutar boş anlaşma yalnız sayı kapsamasına girer. Açık anlaşma yoksa null (veri yoksa kart yok).
 */
export function pipelineCoverage(input: {
  deals: readonly CoverageDeal[];
  commissionRatePct: number;
  remainingRevenue: number | null;
  remainingDeals: number | null;
}): PipelineCoverage | null {
  let weightedCommission = 0;
  let weightedDeals = 0;
  let openCount = 0;
  const rate = Number.isFinite(input.commissionRatePct) && input.commissionRatePct > 0 ? input.commissionRatePct / 100 : 0;
  for (const d of input.deals) {
    const p = d.probability != null && Number.isFinite(d.probability) ? d.probability : STAGE_DEFAULT_PROBABILITY[d.stage];
    if (p == null) continue;
    const share = Math.max(0, Math.min(100, p)) / 100;
    openCount += 1;
    weightedDeals += share;
    if (d.value != null && d.value > 0) weightedCommission += d.value * rate * share;
  }
  if (openCount === 0) return null;
  const ratio = (num: number, rem: number | null) => (rem != null && rem > 0 ? Math.round((num / rem) * 10) / 10 : null);
  return {
    weightedCommission: Math.round(weightedCommission),
    weightedDeals: Math.round(weightedDeals * 10) / 10,
    revenueCoverage: ratio(weightedCommission, input.remainingRevenue),
    dealCoverage: ratio(weightedDeals, input.remainingDeals),
    openCount,
  };
}
