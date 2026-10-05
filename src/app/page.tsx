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
import { EmlakFiyatiSection } from "@/components/marketing/emlakfiyati-section";
import { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import { Faq, buildHomeFaqs } from "@/components/marketing/faq";
import { Highlights } from "@/components/marketing/highlights";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { FinalCta } from "@/components/marketing/final-cta";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";
import "./marketing.css";
import "./marketing-sections.css";

// Canonical "/" burada verilir (kökte yok); başlık/açıklama/OG ayarlardan, ayar yokken layout varsayılanı.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/");
}

/**
 * Ana sayfa yalnızca bölümleri birleştirir ("Kurumsal Parlak"). Statik sayfa: cookies()/headers() yok;
 * hero'da istemci JS yok. Public sayfa her zaman açık temadır.
 */
export default async function HomePage() {
  const [pricing, efCatalog] = await Promise.all([getPublicPricing(), getEfCatalog()]);
  const faqs = buildHomeFaqs({ trialDays: pricing.trialDays, plans: pricing.plans });
  return (
    <div className="mk">
      <LandingJsonLd faq={faqs} />
      <SiteHeader />
      <main id="main-content">
        <HeroSection trialDays={pricing.trialDays} />
        <ValueCards />
        <TrustStrip trialDays={pricing.trialDays} />
        <ProductTour />
        <BentoGrid />
        <Highlights />
        <Why />
        <HowItWorks trialDays={pricing.trialDays} />
        <SecurityBand />
        <PricingSection pricing={pricing} />
        <EmlakFiyatiSection pricing={pricing} tariff={efCatalog.tariff} packs={efCatalog.packs} />
        <Faq items={faqs} />
        <FinalCta trialDays={pricing.trialDays} plans={pricing.plans} />
      </main>
      <SiteFooter />
    </div>
  );
}
