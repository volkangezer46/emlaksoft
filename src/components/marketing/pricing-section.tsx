import { Pricing } from "@/components/pricing";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { Em, SectionHeading } from "./section-heading";

/** Fiyatlar ve paket içerikleri her zaman plans.ts'ten okunur (Pricing bileşeni). */
export async function PricingSection() {
  const plans = await getPlanDefinitions();
  return (
    <section id="fiyat" className="mk-section" aria-labelledby="fiyat-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Fiyat" title={<span id="fiyat-baslik">Gizli maliyet yok, <Em>sürpriz yok.</Em></span>} text="KDV hariç aylık fiyatlar. Taahhüt yok, dilediğiniz an iptal edin." />
        <div className="mk-price-wrap">
          <Pricing plans={plans} />
        </div>
      </div>
    </section>
  );
}
