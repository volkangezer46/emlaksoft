import Link from "next/link";
import { Pricing } from "@/components/pricing";
import { SeatCalculatorLazy } from "@/components/pricing-page/seat-calculator-lazy";
import { extraSeatTexts } from "@/lib/billing/seat-calculator-model";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { yearlyOffer } from "@/lib/marketing-copy";
import { Em, SectionHeading } from "./section-heading";

/** Fiyatlar, limitler, kampanya ve deneme günü tek kaynaktan (admin paket tanımları) okunur; sabit tutar yazılmaz. */
export function PricingSection({ pricing }: { pricing: PublicPricing }) {
  const { plans, trialDays, offers, founders, efValuationCost } = pricing;
  const offer = yearlyOffer(plans);
  return (
    <section id="fiyat" className="mk-section" aria-labelledby="fiyat-baslik">
      <div className="mk-wrap">
        <SectionHeading
          center
          eyebrow="Fiyat"
          title={<span id="fiyat-baslik">Gizli maliyet yok, <Em>sürpriz yok.</Em></span>}
          text={`KDV hariç fiyatlar. Taahhüt yok, dilediğiniz an iptal edin.${offer ? ` Yıllık ödemede ${offer.label}.` : ""}`}
        />
        <div className="mx-auto mt-8 max-w-5xl">
          <SeatCalculatorLazy plans={plans} offers={offers} trialDays={trialDays} />
        </div>
        <div className="mk-price-wrap mk-reveal">
          <Pricing plans={plans} trialDays={trialDays} offers={offers} founders={founders} extraSeats={extraSeatTexts(plans)} efValuationCost={efValuationCost} />
        </div>
        <p className="mk-fine">
          Paketleri özellik özellik karşılaştırmak ve kaçan komisyonu kendi sayılarınızla hesaplamak için <Link href="/fiyatlar">Fiyatlar sayfasına</Link> gidin.
        </p>
      </div>
    </section>
  );
}
