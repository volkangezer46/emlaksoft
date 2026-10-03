import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSection } from "@/components/marketing/hero/hero-section";
import { ValueCards } from "@/components/marketing/value-cards";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { LandingJsonLd } from "@/components/marketing/landing-jsonld";
import "./marketing.css";

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
      </main>
      <SiteFooter />
    </div>
  );
}
