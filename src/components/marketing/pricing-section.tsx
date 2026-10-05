import Link from "next/link";
import { Pricing } from "@/components/pricing";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import { yearlyOffer } from "@/lib/marketing-copy";
import { Em, SectionHeading } from "./section-heading";

/** Fiyatlar, limitler, kampanya ve deneme günü tek kaynaktan (admin paket tanımları) okunur; sabit tutar yazılmaz. */
export function PricingSection({ pricing }: { pricing: PublicPricing }) {
  const { plans, trialDays, offers, founders } = pricing;
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
        <div className="mk-price-wrap mk-reveal">
          <Pricing plans={plans} trialDays={trialDays} offers={offers} founders={founders} />
        </div>
        <p className="mk-fine">
          Paketleri özellik özellik karşılaştırmak ve kaçan komisyonu kendi sayılarınızla hesaplamak için <Link href="/fiyatlar">Fiyatlar sayfasına</Link> gidin.
        </p>
      </div>
    </section>
  );
}
