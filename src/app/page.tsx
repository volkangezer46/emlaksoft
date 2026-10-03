import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { ValueCards } from "@/components/marketing/value-cards";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ProductTour } from "@/components/marketing/product-tour/product-tour";
import { BentoGrid } from "@/components/marketing/bento/bento-grid";
import { Why } from "@/components/marketing/why";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SecurityBand } from "@/components/marketing/security-band";
import { PricingSection } from "@/components/marketing/pricing-section";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import "./marketing.css";
import "./marketing-sections.css";

/**
 * Ana sayfa yalnızca bölümleri birleştirir ("Kurumsal Parlak"). Statik sayfa: cookies()/headers() yok;
 * hero'da istemci JS yok. Public sayfa her zaman açık temadır.
 */
export default function HomePage() {
  return (
    <div className="mk">
      <LandingJsonLd />
      <SiteHeader />
      <main id="main-content">
        <HeroSection />
        <ValueCards />
        <TrustStrip />
        <ProductTour />
        <BentoGrid />
        <Why />
        <HowItWorks />
        <SecurityBand />
        <PricingSection />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
