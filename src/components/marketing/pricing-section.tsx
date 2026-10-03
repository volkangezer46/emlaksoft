import { Pricing } from "@/components/pricing";
import { Em, SectionHeading } from "./section-heading";

/** Fiyatlar ve paket içerikleri her zaman plans.ts'ten okunur (Pricing bileşeni). */
export function PricingSection() {
  return (
    <section id="fiyat" className="mk-section" aria-labelledby="fiyat-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Fiyat" title={<span id="fiyat-baslik">Gizli maliyet yok, <Em>sürpriz yok.</Em></span>} text="KDV hariç aylık fiyatlar. Taahhüt yok, dilediğiniz an iptal edin." />
        <div className="mk-price-wrap">
          <Pricing />
        </div>
      </div>
    </section>
  );
}
