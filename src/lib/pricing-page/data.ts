import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import type { PricingCopyContext } from "./copy";
import type { PricingViewData } from "./view";

/** /fiyatlar verisi (sunucu): fiyatlar plan editöründen, EmlakFiyati kataloğu tarifeden. Sayfa ve önizleme ortak. */
export async function loadPricingViewData(): Promise<PricingViewData> {
  const [pricing, efCatalog] = await Promise.all([getPublicPricing(), getEfCatalog()]);
  const { plans, trialDays, offers, founders, efValuationCost, efLive } = pricing;
  return { plans, trialDays, offers, founders, efValuationCost, efLive, efCatalog };
}

export function copyContextOf(data: Pick<PricingViewData, "plans" | "trialDays" | "efLive">): PricingCopyContext {
  return { plans: data.plans, trialDays: data.trialDays, efLive: data.efLive };
}
