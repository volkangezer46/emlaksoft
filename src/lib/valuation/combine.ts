/**
 * Çok kaynaklı değerlemenin SAF birleştirme kuralları — `estimateMultiSourceValue` (ilk hesap) ve danışmanın emsal
 * seçimiyle yeniden hesap (`comparable-selection.ts`) AYNI kuralı kullanır; iki yol arasında rakam zıplamaz.
 * Sunucu bağımlılığı yok (test edilebilir).
 */

export type ValuationSourceLike = { name: string; weight: number; value: number; note: string };

export type ComparableConfidenceLevel = "yüksek" | "orta" | "düşük" | "yetersiz";
export type MarketIndexLevel = "none" | "low" | "medium" | "high";

/** Emsal kaynağının rapordaki adı (kayıtlı değerlemelerde bu adla aranır). */
export const COMPARABLE_SOURCE_LABEL = "Emsal analizi (kendi verimiz)";

/** Ağırlık güvene bağlı: az emsalle sonuç domine edilmesin. */
export function comparableSourceWeight(confidence: ComparableConfidenceLevel): number {
  return confidence === "yüksek" ? 0.5 : confidence === "orta" ? 0.35 : 0.15;
}

/**
 * This is an evidence score, not a statistical probability. A seller's list
 * price is only a weak anchor; independent provider data and comparable sales
 * increase the score. Keeping the calculation explicit prevents source count
 * alone from making a single asking price look trustworthy.
 */
export function valuationEvidenceConfidence(input: {
  hasListPrice: boolean;
  comparableConfidence: ComparableConfidenceLevel | null;
  /** EmlakFiyati endeksinin güven kademesi; "none" = kullanılmadı ya da örneklem yetersiz. */
  marketIndex: MarketIndexLevel;
}): number {
  const hasComparable = input.comparableConfidence != null && input.comparableConfidence !== "yetersiz";
  const hasMarketIndex = input.marketIndex !== "none";
  const evidenceCount = Number(hasComparable) + Number(hasMarketIndex);
  if (!input.hasListPrice && evidenceCount === 0) return 0;

  let score = 0.15 + (input.hasListPrice ? 0.1 : 0);
  if (input.comparableConfidence === "yüksek") score += 0.55;
  else if (input.comparableConfidence === "orta") score += 0.4;
  else if (input.comparableConfidence === "düşük") score += 0.25;
  if (input.marketIndex === "high") score += 0.2;
  else if (input.marketIndex === "medium") score += 0.15;
  else if (input.marketIndex === "low") score += 0.08;
  if (evidenceCount >= 2) score += 0.05;
  return Math.min(0.95, Math.round(score * 100) / 100);
}

/**
 * Ağırlıklı orta değer + gözlemlenebilir bant. Bant yalnız emsal yayılımı ya da en az iki fiyat kaynağının
 * anlaşmazlığı varsa üretilir; tek liste fiyatının etrafında yapay ±% bandı GÖSTERİLMEZ (alt/üst null kalır).
 * Fiyat kaynağı yoksa null döner (çağıran "değer üretilemedi" der).
 */
export function combinePriceSources(
  sources: readonly ValuationSourceLike[],
  comparableSpreadPct: number | null,
): { low: number | null; mid: number; high: number | null } | null {
  const priceSources = sources.filter((s) => s.weight > 0 && Number.isFinite(s.value) && s.value > 0);
  if (priceSources.length === 0) return null;
  const totalW = priceSources.reduce((s, x) => s + x.weight, 0);
  const mid = Math.round(priceSources.reduce((s, x) => s + x.value * x.weight, 0) / totalW);
  const observedBand =
    comparableSpreadPct !== null && comparableSpreadPct >= 0
      ? comparableSpreadPct / 200
      : priceSources.length >= 2
        ? (Math.max(...priceSources.map((x) => x.value)) - Math.min(...priceSources.map((x) => x.value))) / (2 * mid)
        : null;
  const band = observedBand === null ? null : Math.min(Math.max(observedBand, 0.03), 0.2);
  return {
    low: band === null ? null : Math.round(mid * (1 - band)),
    mid,
    high: band === null ? null : Math.round(mid * (1 + band)),
  };
}
