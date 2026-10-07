import { DEFAULT_YEARLY_PAID_MONTHS, yearlyOfferLabel, type PlanDef } from "@/lib/billing/plans";

/**
 * Ana sayfa ve pazarlama metinlerinde geçen paket/deneme ifadeleri TEK yerden üretilir.
 * Kaynak: getPublicPricing() (admin paket tanımları + getEffectiveTrialDays); sayfalarda sabit gün/oran yazılmaz.
 */

/** "30 gün ücretsiz" (gün bilinmiyorsa sayı yazmadan "Ücretsiz"). */
export function trialShort(trialDays?: number): string {
  return trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz";
}

/**
 * Birincil CTA: "Ofisini ücretsiz kur — 14 gün, kart gerekmez" (gün bilinmiyorsa "Ofisini ücretsiz kur — kart gerekmez").
 * Satış demosu/görüşme talebi akışı yoktur; tek yol self-servis kurulum sihirbazıdır (/kayit).
 */
export function trialCtaLabel(trialDays?: number): string {
  return trialDays ? `Ofisini ücretsiz kur — ${trialDays} gün, kart gerekmez` : "Ofisini ücretsiz kur — kart gerekmez";
}

/**
 * Mobil (< 768 px) birincil CTA: "Ücretsiz dene — 14 gün" (gün bilinmiyorsa "Ücretsiz dene"). Tam genişlik düğmede tek satır
 * kalır; "kart gerekmez" bilgisi hemen altındaki güven rozetlerinde yazar. Hero ve akıllı alt çubuk bunu kullanır.
 */
export function trialCtaMobileLabel(trialDays?: number): string {
  return trialDays ? `Ücretsiz dene — ${trialDays} gün` : "Ücretsiz dene";
}

/** Paket kartı gibi dar yerler için kısa CTA (gün/kart cümlesi kartın altında ayrıca yazılır). */
export function trialCtaShort(): string {
  return "Ofisini ücretsiz kur";
}

/**
 * Yıllık ödeme teklifi: tüm satılan paketlerde aynıysa "10 öde 12 kullan" biçiminde, farklıysa null
 * (metin uydurulmaz). `gift` ödenmeyen ay sayısıdır.
 */
export function yearlyOffer(plans: readonly PlanDef[]): { label: string; gift: number } | null {
  const priced = plans;
  if (priced.length === 0) return null;
  const labels = new Set(priced.map((p) => yearlyOfferLabel(p)));
  if (labels.size !== 1) return null;
  const paid = priced[0]!.yearlyPaidMonths ?? DEFAULT_YEARLY_PAID_MONTHS;
  if (paid >= 12) return null;
  return { label: [...labels][0]!, gift: 12 - paid };
}
