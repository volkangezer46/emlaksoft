import { Fragment, type ReactNode } from "react";
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
import { Highlights } from "@/components/marketing/highlights";
import { ValuationSection } from "@/components/marketing/valuation-section";
import { FinalCta } from "@/components/marketing/final-cta";
import { Testimonials } from "@/components/marketing/testimonials";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import { MotionRoot } from "@/components/marketing/motion-root";
import type { PublicPricing } from "@/lib/billing/public-pricing";
import type { EfCatalog } from "@/lib/ef-credits/credit-reader";
import { visibleSections, type LandingSectionId, type SiteContent } from "@/lib/site-content/schema";

export type RenderHomeInput = {
  content: SiteContent;
  pricing: PublicPricing;
  efCatalog: EfCatalog;
  /** Taslak önizlemesi (/onizleme/ana-sayfa): üstte sabit "TASLAK" şeridi. Canlı ana sayfada hiç verilmez. */
  preview?: boolean;
};

/** Önizleme şeridi: pazarlama CSS'ine yeni sınıf eklemeden (statik ana sayfa CSS'i değişmesin diye) satır içi stil. */
const PREVIEW_BAR: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 100,
  padding: "8px 16px",
  background: "#8a5200",
  color: "#fff",
  font: "700 14px/1.4 system-ui, sans-serif",
  textAlign: "center",
  letterSpacing: "0.02em",
};

/**
 * Ana sayfa gövdesi ("Kurumsal Parlak"): bölümleri birleştirir. Canlı ana sayfa (src/app/page.tsx, yayındaki içerik) ve taslak
 * önizlemesi (src/app/onizleme/ana-sayfa, taslak içerik) AYNI işlevi çağırır; böylece önizleme gerçek sayfa düzeniyle,
 * gerçek paket ve deneme verisiyle çizilir. Saf sunucu bileşeni ağacı: kendisi çerez/başlık okumaz (ana sayfa statik kalır).
 * Hero sunucu bileşenidir; tek istemci kodu MotionRoot (markup eklemez: giriş animasyonu ve gösterim duraklatma).
 */
export function renderHome({ content, pricing, efCatalog, preview = false }: RenderHomeInput): ReactNode {
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
    // Kanıtlı yorumlar: öğe yoksa bileşen hiçbir şey çizmez (varsayılan düzende zaten gizli).
    testimonials: <Testimonials content={content.testimonials} />,
  };
  const shown = visibleSections(content);
  return (
    <div className="mk">
      {preview ? (
        <p role="status" data-preview-bar="" style={PREVIEW_BAR}>
          TASLAK ÖNİZLEME, yayında değil
        </p>
      ) : null}
      {/* FAQPage verisi yalnız SSS bölümü görünürken (görünen içerikle aynı liste). */}
      <LandingJsonLd faq={shown.includes("sss") ? faqForJsonLd(faqs) : []} />
      <MotionRoot />
      <SiteHeader />
      <main id="main-content">
        <HeroSection trialDays={trialDays} plans={plans} content={content.hero} efLive={pricing.efLive} />
        {shown.map((id) => <Fragment key={id}>{sections[id]}</Fragment>)}
      </main>
      <SiteFooter smartCta trialDays={trialDays} />
    </div>
  );
}
