import { ruleBase } from "@/lib/insights/types";

/**
 * Kural kalite bastırması (SAF): yanlış alarm oranı yüksek bir kuralı o ofiste SESSİZE al.
 *
 * Oran = "yanlış" diye yoksayılan / (uygulanan + yoksayılan) — `insight_rule_quality` görünümü (son 90 gün).
 * Karar eşiği ürün verisiyle ayarlanacak ilk değerdir (plan G10): en az MIN_REVIEWED değerlendirme VE oran > %40.
 * Eşiğin altındaki örneklemde HİÇBİR kural bastırılmaz (az veriyle hüküm verilmez).
 */

export const QUALITY_MIN_REVIEWED = 10;
export const QUALITY_WRONG_RATE_PCT = 40;

export type RuleQualityRow = {
  ruleId: string;
  accepted: number;
  dismissed: number;
  dismissedWrong: number;
};

/** Bastırılacak kural taban adları (örn. "deal_risk"). */
export function qualitySuppressedRules(rows: readonly RuleQualityRow[]): Set<string> {
  // Aynı kuralın sürümleri toplanır.
  const agg = new Map<string, { reviewed: number; wrong: number }>();
  for (const r of rows) {
    const base = ruleBase(r.ruleId);
    const cur = agg.get(base) ?? { reviewed: 0, wrong: 0 };
    cur.reviewed += Math.max(0, r.accepted) + Math.max(0, r.dismissed);
    cur.wrong += Math.max(0, r.dismissedWrong);
    agg.set(base, cur);
  }
  const out = new Set<string>();
  for (const [base, a] of agg) {
    if (a.reviewed < QUALITY_MIN_REVIEWED) continue;
    if ((a.wrong / a.reviewed) * 100 > QUALITY_WRONG_RATE_PCT) out.add(base);
  }
  return out;
}
