import { ArrowRight, CalendarCheck, Check, Zap } from "lucide-react";
import { HeroScene } from "./hero-scene";
import { HeroPhoneScene } from "./hero-phone";
import { PortalStrip } from "../portal-strip";
import { ContentLink, Lines } from "../content-link";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { heroMobileCopy } from "@/lib/site-content/hero-mobile";
import type { SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";

/** Masaüstü/mobil metin çifti: aynıysa tek metin; farklıysa CSS kırılımı (768 px) hangisinin görüneceğini seçer. */
function Pair({ desk, mobile }: { desk: string; mobile: string }) {
  if (desk === mobile) return <>{desk}</>;
  return (
    <>
      <span className="mk-dl">{desk}</span>
      <span className="mk-ml">{mobile}</span>
    </>
  );
}

/**
 * Hero: sol metin bloğu + sağ ürün sahnesi. Sunucu bileşeni, istemci JS yok. Metinler site içeriğinden (varsayılan = bugünkü metin).
 * Mobil (< 768 px): tek cümle açıklama (`hero.mobileLead`), kısa düğme etiketi, metin bağlantısı, sıkı güven çipleri ve
 * telefon sahnesi (HeroPhoneScene); EmlakFiyati satırı mobilde gizlidir (kendi bölümünde durur). Masaüstü çıktı değişmez.
 */
export function HeroSection({
  trialDays,
  plans = [],
  content = defaultSiteContent().hero,
}: {
  trialDays?: number;
  plans?: readonly PlanDef[];
  content?: SiteContent["hero"];
}) {
  const ctx = { trialDays, plans };
  const m = heroMobileCopy(content, ctx);
  return (
    <>
    <section className="mk-hero" aria-labelledby="hero-baslik">
      <div className="mk-hero-bg" aria-hidden="true" />
      <div className="mk-wrap mk-wrap-wide mk-hero-grid">
        <div className="mk-hero-copy">
          <p className="mk-badge"><Zap size={15} aria-hidden="true" />{tx(content.badge, ctx)}</p>
          <h1 id="hero-baslik" className="mk-h1">
            {content.title ? `${content.title} ` : null}
            {content.em ? <span className="mk-grad">{content.em}</span> : null}
            {content.tail ? ` ${content.tail}` : null}
          </h1>
          <p className="mk-hero-lead"><Lines text={tx(content.lead, ctx)} /></p>
          {m.lead ? <p className="mk-hero-lead-m">{m.lead}</p> : null}
          {content.integrationBadge || content.integrationLine ? (
            <p className="mk-hero-int" data-hero-integration="">
              {content.integrationBadge ? <a href="#degerleme" className="mk-tag mk-tag-plan">{tx(content.integrationBadge, ctx)}</a> : null}
              {content.integrationBadge && content.integrationLine ? " " : null}
              {content.integrationLine ? tx(content.integrationLine, ctx) : null}
            </p>
          ) : null}
          <div className="mk-cta-row">
            <ContentLink href={content.primary.href} className="mk-btn mk-btn-grad btn-shine mk-hero-primary"><Pair desk={tx(content.primary.label, ctx)} mobile={m.primary} /> <ArrowRight size={18} aria-hidden="true" /></ContentLink>
            <ContentLink href={content.secondary.href} className="mk-btn mk-btn-ghost mk-hero-secondary"><CalendarCheck size={18} aria-hidden="true" /><Pair desk={tx(content.secondary.label, ctx)} mobile={m.secondary} /><ArrowRight className="mk-ml" size={16} aria-hidden="true" /></ContentLink>
          </div>
          <ul className="mk-checks">
            {m.checks.map((c) => <li key={c.id}><Check size={16} aria-hidden="true" /><Pair desk={c.text} mobile={c.short} /></li>)}
          </ul>
        </div>
        <HeroPhoneScene />
        <HeroScene />
      </div>
    </section>
    {/* Portal şeridi hero kutusunun DIŞINDA: hero yüksekliği (1440'ta <=780px hedefi) şeritten bağımsız. */}
    <PortalStrip />
    </>
  );
}
