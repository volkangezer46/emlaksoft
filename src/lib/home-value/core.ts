/**
 * "Evinizin güncel değeri" (SAF) — müşteri portalı özeti. Ofis ayarı `office.customer_portal.home_value_enabled`
 * (varsayılan KAPALI).
 *
 * KURAL: yalnız ofisin emsal motoru (`estimate_property_value`) "orta" veya "yüksek" güven verirse ARALIK gösterilir;
 * "düşük"/"yetersiz" güvende HİÇ gösterilmez (emsal yoksa değer yok). Tek sayı değil aralık; "tahmin" etiketi zorunlu;
 * emsallerin adresi/fiyatı/kim olduğu gösterilmez (yalnız sayı). Ofiste örnek veri varken gösterilmez (emsali bozar).
 */

export type HomeValueEstimate = {
  lowValue: number | null;
  highValue: number | null;
  estimatedValue: number | null;
  compCount: number;
  confidence: "yüksek" | "orta" | "düşük" | "yetersiz";
};

export type HomeValueDisplay = { low: number; high: number; compCount: number; confidence: "yüksek" | "orta" };

/** En yakın 10.000 TL'ye yuvarlar (aralık hassasiyet iddiası taşımasın). */
export function roundTo10k(n: number): number {
  return Math.round(n / 10_000) * 10_000;
}

export function homeValueDisplay(e: HomeValueEstimate | null): HomeValueDisplay | null {
  if (!e || (e.confidence !== "yüksek" && e.confidence !== "orta")) return null;
  if (e.lowValue == null || e.highValue == null || !(e.lowValue > 0) || !(e.highValue >= e.lowValue)) return null;
  if (e.compCount < 3) return null;
  const low = roundTo10k(e.lowValue);
  const high = Math.max(low, roundTo10k(e.highValue));
  return { low, high, compCount: e.compCount, confidence: e.confidence };
}

export const HOME_VALUE_NOTE =
  "Bu bir TAHMİNDİR: ofisimizin bölgedeki kapanan satışları ve aktif ilanlarından (emsal) hesaplanır; ekspertiz veya resmî değerleme değildir. " +
  "Satış düşünüyorsanız danışmanınız güncel piyasa analizi hazırlayabilir.";
