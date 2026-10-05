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
import { Faq, buildHomeFaqs, faqForJsonLd } from "@/components/marketing/faq";
import { EmlakFiyatiSection } from "@/components/marketing/emlakfiyati-section";
import { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import { Highlights } from "@/components/marketing/highlights";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getLiveSiteContent } from "@/lib/site-content/store";
import { ValuationSection } from "@/components/marketing/valuation-section";
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
 * Ana sayfa yalnızca bölümleri birleştirir ("Kurumsal Parlak"). Statik sayfa: çerez/başlık okuması yok;
 * hero'da istemci JS yok. Public sayfa her zaman açık temadır.
 */
export default async function HomePage() {
  // Metinler yönetim panelinden (Site içeriği); yayın yoksa bugünkü metin. Okuma sunucuda, etiketli önbellekten (sayfa statik kalır).
  const [pricing, content] = await Promise.all([getPublicPricing(), getLiveSiteContent()]);
  const efCatalog = await getEfCatalog();
  const { trialDays, plans } = pricing;
  const faqs = buildHomeFaqs({ trialDays, plans, content: content.faq });
  return (
    <div className="mk">
      <LandingJsonLd faq={faqForJsonLd(faqs)} />
      <SiteHeader />
      <main id="main-content">
        <HeroSection trialDays={trialDays} plans={plans} content={content.hero} />
        <ValueCards trialDays={trialDays} plans={plans} content={content.valueCards} />
        <TrustStrip trialDays={trialDays} content={content.trust} />
        <ProductTour heading={content.sections.tur} />
        <BentoGrid heading={content.sections.ozellikler} />
        <ValuationSection status={pricing.efLive ? "live" : "soon"} state={pricing.efState} trialDays={trialDays} plans={plans} content={content.valuation} />
        <EmlakFiyatiSection pricing={pricing} tariff={efCatalog.tariff} packs={efCatalog.packs} />
        <Highlights heading={content.sections.diger} content={content.highlights} />
        <Why heading={content.sections.neden} />
        <HowItWorks trialDays={trialDays} plans={plans} steps={content.steps} heading={content.sections.nasil} />
        <SecurityBand trialDays={trialDays} plans={plans} content={content.security} heading={content.sections.guvenlik} />
        <PricingSection pricing={pricing} heading={content.sections.fiyat} />
        <Faq items={faqs} heading={content.sections.sss} />
        <FinalCta trialDays={trialDays} plans={plans} content={content.finalCta} />
      </main>
      <SiteFooter />
    </div>
  );
}
