import Link from "next/link";
import { Pricing } from "@/components/pricing";
import { SeatCalculatorLazy } from "@/components/pricing-page/seat-calculator-lazy";
import { extraSeatTexts } from "@/lib/billing/seat-calculator-model";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/** Fiyatlar, limitler, kampanya ve deneme günü tek kaynaktan (admin paket tanımları) okunur; sabit tutar yazılmaz. */
export function PricingSection({ pricing, heading = defaultSiteContent().sections.fiyat }: { pricing: PublicPricing; heading?: Heading }) {
  const { plans, trialDays, offers, founders, efValuationCost, efLive } = pricing;
  return (
    <section id="fiyat" className="mk-section" aria-labelledby="fiyat-baslik">
      <div className="mk-wrap">
        <SectionHeading
          center
          eyebrow={heading.eyebrow}
          title={<span id="fiyat-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>}
          text={heading.text ? tx(heading.text, { trialDays, plans, efLive }) : undefined}
        />
        <div className="mx-auto mt-8 max-w-5xl">
          <SeatCalculatorLazy plans={plans} offers={offers} trialDays={trialDays} />
        </div>
        <div className="mk-price-wrap mk-reveal">
          <Pricing plans={plans} trialDays={trialDays} offers={offers} founders={founders} extraSeats={extraSeatTexts(plans)} efValuationCost={efValuationCost} efLive={efLive} />
        </div>
        <p className="mk-fine">
          Paketleri özellik özellik karşılaştırmak ve kaçan komisyonu kendi sayılarınızla hesaplamak için <Link href="/fiyatlar">Fiyatlar sayfasına</Link> gidin.
        </p>
      </div>
    </section>
  );
}
