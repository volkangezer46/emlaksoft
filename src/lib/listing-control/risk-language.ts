import type { AnomalySeverity } from "./types";

/**
 * TEK RİSK DİLİ (SAF). Kayıp-Kaçak Kalkanı (`listing_closures.leak_severity`: tutar + gün) ile İlan Kontrol (anomali
 * `risk_score` 0-100 ve `severity`) aynı dört bantla konuşur: Kritik / Yüksek / Orta / Düşük. Böylece iki ekranda aynı
 * olay farklı etiketle görünmez. Eşikler TEK yerde: skor >= 90 kritik, >= 70 yüksek, >= 40 orta, altı düşük.
 * Kapanış önem derecesinin kendisi (`leakSeverity`, tutar/gün eşikleri) `sla-plan.ts`'te kalır ve bu bantlara birebir
 * eşlenir; ikisi de `maxBand` ile birleştirilebilir (örn. aynı portföy için kapanış kaydı + açık anomali).
 */

export type RiskBand = "critical" | "high" | "medium" | "low";
export type RiskBandOrNone = RiskBand | "none";

export const RISK_BAND_LABEL: Record<RiskBandOrNone, string> = {
  critical: "Kritik",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
  none: "Ölçülmedi",
};

const ORDER: Record<RiskBandOrNone, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

export const RISK_SCORE_THRESHOLDS = { critical: 90, high: 70, medium: 40 } as const;

export function bandFromScore(score: number | null | undefined): RiskBandOrNone {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  if (score >= RISK_SCORE_THRESHOLDS.critical) return "critical";
  if (score >= RISK_SCORE_THRESHOLDS.high) return "high";
  if (score >= RISK_SCORE_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Anomali önem derecesi (5 kademe) -> bant. `info` düşük sayılır. */
export function bandFromAnomalySeverity(severity: AnomalySeverity | string | null | undefined): RiskBandOrNone {
  switch (severity) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
    case "info":
      return "low";
    default:
      return "none";
  }
}

/** Kalkan kapanış önem derecesi (`leakSeverity` çıktısı) -> bant (aynı dört değer; birebir). */
export function bandFromLeakSeverity(severity: "low" | "medium" | "high" | "critical" | null | undefined): RiskBandOrNone {
  return severity ?? "none";
}

export function maxBand(...bands: readonly RiskBandOrNone[]): RiskBandOrNone {
  return bands.reduce<RiskBandOrNone>((best, b) => (ORDER[b] > ORDER[best] ? b : best), "none");
}

export function bandLabel(band: RiskBandOrNone): string {
  return RISK_BAND_LABEL[band];
}
