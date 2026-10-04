import { DEFAULT_YEARLY_PAID_MONTHS, yearlyOfferLabel, type PlanDef } from "@/lib/billing/plans";

/**
 * Ana sayfa ve pazarlama metinlerinde geçen paket/deneme ifadeleri TEK yerden üretilir.
 * Kaynak: getPublicPricing() (admin paket tanımları + getEffectiveTrialDays); sayfalarda sabit gün/oran yazılmaz.
 */

/** "30 gün ücretsiz" (gün bilinmiyorsa sayı yazmadan "Ücretsiz"). */
export function trialShort(trialDays?: number): string {
  return trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz";
}

/** "30 gün ücretsiz dene" düğme/etiket metni. */
export function trialCtaLabel(trialDays?: number): string {
  return `${trialShort(trialDays)} dene`;
}

/**
 * Yıllık ödeme teklifi: tüm satılan paketlerde aynıysa "10 öde 12 kullan" biçiminde, farklıysa null
 * (metin uydurulmaz). `gift` ödenmeyen ay sayısıdır.
 */
export function yearlyOffer(plans: readonly PlanDef[]): { label: string; gift: number } | null {
  const priced = plans.filter((p) => !p.customPricing);
  if (priced.length === 0) return null;
  const labels = new Set(priced.map((p) => yearlyOfferLabel(p)));
  if (labels.size !== 1) return null;
  const paid = priced[0]!.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  if (paid >= 12) return null;
  return { label: [...labels][0]!, gift: 12 - paid };
}
