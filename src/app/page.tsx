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
import { MotionRoot } from "@/components/marketing/motion-root";
import { Fragment, type ReactNode } from "react";
import type { Metadata } from "next";
import { visibleSections, type LandingSectionId } from "@/lib/site-content/schema";
import { buildMetadata } from "@/lib/seo/store";
import "./marketing.css";
import "./marketing-sections.css";
import "./marketing-motion.css";

// Canonical "/" burada verilir (kökte yok); başlık/açıklama/OG ayarlardan, ayar yokken layout varsayılanı.
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/");
}

/**
 * Ana sayfa yalnızca bölümleri birleştirir ("Kurumsal Parlak"). Statik sayfa: çerez/başlık okuması yok;
 * hero sunucu bileşenidir; tek istemci kodu MotionRoot (markup eklemez: giriş animasyonu ve gösterim duraklatma). Public sayfa her zaman açık temadır.
 */
export default async function HomePage() {
  // Metinler yönetim panelinden (Site içeriği); yayın yoksa bugünkü metin. Okuma sunucuda, etiketli önbellekten (sayfa statik kalır).
  const [pricing, content] = await Promise.all([getPublicPricing(), getLiveSiteContent()]);
  const efCatalog = await getEfCatalog();
  const { trialDays, plans } = pricing;
  const faqs = buildHomeFaqs({ trialDays, plans, content: content.faq });
  // Bölüm sırası ve görünürlüğü site içeriğinden (Yönetim > Site içeriği > Bölüm düzeni); hero her zaman ilk.
  const sections: Record<LandingSectionId, ReactNode> = {
    deger: <ValueCards trialDays={trialDays} plans={plans} content={content.valueCards} />,
    guven: <TrustStrip trialDays={trialDays} content={content.trust} />,
    tur: <ProductTour heading={content.sections.tur} items={content.tour} />,
    ozellikler: <BentoGrid heading={content.sections.ozellikler} content={content.bento} />,
    degerleme: <ValuationSection status={pricing.efLive ? "live" : "soon"} state={pricing.efState} trialDays={trialDays} plans={plans} content={content.valuation} />,
    emlakfiyati: <EmlakFiyatiSection pricing={pricing} tariff={efCatalog.tariff} packs={efCatalog.packs} content={content.efSection} />,
    diger: <Highlights heading={content.sections.diger} content={content.highlights} />,
    neden: <Why heading={content.sections.neden} content={content.why} />,
    nasil: <HowItWorks trialDays={trialDays} plans={plans} steps={content.steps} heading={content.sections.nasil} />,
    guvenlik: <SecurityBand trialDays={trialDays} plans={plans} content={content.security} heading={content.sections.guvenlik} />,
    fiyat: <PricingSection pricing={pricing} heading={content.sections.fiyat} />,
    sss: <Faq items={faqs} heading={content.sections.sss} />,
    son: <FinalCta trialDays={trialDays} plans={plans} content={content.finalCta} />,
  };
  const shown = visibleSections(content);
  return (
    <div className="mk">
      {/* FAQPage verisi yalnız SSS bölümü görünürken (görünen içerikle aynı liste). */}
      <LandingJsonLd faq={shown.includes("sss") ? faqForJsonLd(faqs) : []} />
      <MotionRoot />
      <SiteHeader />
      <main id="main-content">
        <HeroSection trialDays={trialDays} plans={plans} content={content.hero} />
        {shown.map((id) => <Fragment key={id}>{sections[id]}</Fragment>)}
      </main>
      <SiteFooter />
    </div>
  );
}
