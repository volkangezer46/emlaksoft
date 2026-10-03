import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { ProofStrip } from "@/components/marketing/proof-strip";
import { BentoGrid } from "@/components/marketing/bento/bento-grid";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ProductTour } from "@/components/marketing/product-tour/product-tour";
import { LossStory } from "@/components/marketing/loss-story";
import { CommandPaletteArt } from "@/components/marketing/command-palette-art";
import { SecurityBand } from "@/components/marketing/security-band";
import { PricingSection } from "@/components/marketing/pricing-section";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import "./marketing.css";

/**
 * Ana sayfa yalnızca bölümleri birleştirir ("Aydınlık Mimari", docs/design/LANDING_SPEC.md).
 * Statik sayfa: cookies()/headers() yok; hero'da istemci JS yok. Public sayfa her zaman açık temadır.
 */
export default function HomePage() {
  return (
    <div className="mk">
      <LandingJsonLd />
      <SiteHeader />
      <main id="main-content">
        <HeroSection />
        <ProofStrip />
        <BentoGrid />
        <HowItWorks />
        <ProductTour />
        <LossStory />
        <CommandPaletteArt />
        <SecurityBand />
        <PricingSection />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
