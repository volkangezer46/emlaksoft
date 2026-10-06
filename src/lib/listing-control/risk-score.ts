import type { ListingControlConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import type { CheckState } from "./types";

/**
 * RİSK SKORU 0-100 (SAF): `risk = min(100, Σ ağırlık_i × yoğunluk_i)`, yoğunluk 0..1. Ağırlıklar ofis ayarlıdır
 * (varsayılan: portal kayıp 30, CRM işlem yok 30, açıklama yok 20, fiyat değişmiş 10, yetki bitmiş 10).
 * Skor KİŞİYİ değil İLANI puanlar (PANEL_KARAR_1 §6/6); her bileşen gerekçesiyle `points` olarak döner.
 *
 *  - Portal kayıp: onaylı 1.0 · olası 0.5 · şüpheli 0.15 · diğer 0.
 *  - CRM işlem yok: ilan onaylı kayıpsa ve satış/kiralama/iptal (kapanış) kaydı YOKSA 1.0.
 *  - Açıklama yok: kayıp (olası/onaylı) ve açıklanmamışsa min(1, açıklamasız saat / ilk SLA saati).
 *  - Fiyat: portal-CRM sapması toleransın üstünde oransal (tolerans→0, kritik→1).
 *  - Yetki: bitmiş 1.0, `urgentDays` içinde 0.5.
 */

export type RiskInputs = {
  checkState: CheckState;
  /** Satış/kiralama/iptal gibi CRM kapanış kaydı var mı. */
  hasCrmClosure: boolean;
  /** Kayıp anomalisi için kodlu açıklama girildi mi. */
  explained: boolean;
  /** Kayıp (olası/onaylı) durumda açıklamasız geçen saat. */
  hoursUnexplained: number;
  /** max |portal fiyatı − CRM fiyatı| / CRM fiyatı; bilinmiyorsa null. */
  priceDeviationRatio: number | null;
  /** Yetki bitişine kalan gün (negatif = bitmiş); yetkisiz/süresiz null. */
  authorityDaysLeft: number | null;
};

export type RiskPoint = { key: string; label: string; weight: number; density: number; points: number };
export type RiskResult = { score: number; points: RiskPoint[] };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function computeRiskScore(
  input: RiskInputs,
  cfg: Pick<ListingControlConfig, "riskWeights" | "price" | "sla" | "authority"> = DEFAULT_LISTING_CONTROL_CONFIG,
): RiskResult {
  const w = cfg.riskWeights;
  const missingDensity =
    input.checkState === "confirmed_missing" ? 1 : input.checkState === "probable_missing" ? 0.5 : input.checkState === "suspect" ? 0.15 : 0;
  const isMissing = input.checkState === "probable_missing" || input.checkState === "confirmed_missing";
  const noCrm = input.checkState === "confirmed_missing" && !input.hasCrmClosure ? 1 : 0;
  const noExplain = isMissing && !input.explained ? clamp01(input.hoursUnexplained / Math.max(cfg.sla.teamLeadHours, 1)) : 0;
  let price = 0;
  if (input.priceDeviationRatio !== null && input.priceDeviationRatio > cfg.price.toleranceRatio) {
    price = clamp01(
      (input.priceDeviationRatio - cfg.price.toleranceRatio) / Math.max(cfg.price.criticalRatio - cfg.price.toleranceRatio, 1e-9),
    );
  }
  let authority = 0;
  if (input.authorityDaysLeft !== null) {
    if (input.authorityDaysLeft < 0) authority = 1;
    else if (input.authorityDaysLeft <= cfg.authority.urgentDays) authority = 0.5;
  }
  const rows: [string, string, number, number][] = [
    ["portal_missing", "Portal ilanı kayıp", w.portalMissing, missingDensity],
    ["no_crm_action", "CRM'de işlem kaydı yok", w.noCrmAction, noCrm],
    ["no_explanation", "Açıklama girilmemiş", w.noExplanation, noExplain],
    ["price_changed", "Fiyat uyuşmuyor", w.priceChanged, price],
    ["authority_expired", "Yetki belgesi bitmiş/bitiyor", w.authorityExpired, authority],
  ];
  const points: RiskPoint[] = rows.map(([key, label, weight, density]) => ({
    key,
    label,
    weight,
    density,
    points: Math.round(weight * density * 10) / 10,
  }));
  const total = Math.min(100, Math.round(points.reduce((s, p) => s + p.points, 0)));
  return { score: total, points };
}
