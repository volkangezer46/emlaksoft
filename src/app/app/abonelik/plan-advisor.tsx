import { getPublicPricing } from "@/lib/billing/public-pricing";
import { PlanAdvisorPanel } from "./plan-advisor-panel";

/**
 * "Ekibine göre paket öner": kayıttan buraya taşınan animasyonlu paket seçici (açılınca iner). Fiyat/öneri fiyat sayfasıyla
 * AYNI motordan gelir; asıl paket değişikliği ve ödeme hemen altındaki paket kartlarındadır. Akışla yüklenir (Suspense).
 */
export async function PlanAdvisor() {
  const { plans, offers, trialDays, efValuationCost, efLive } = await getPublicPricing();
  return (
    <PlanAdvisorPanel
      plans={plans}
      offers={offers}
      trialText={trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme"}
      efValuationCost={efValuationCost}
      efLive={efLive}
    />
  );
}
