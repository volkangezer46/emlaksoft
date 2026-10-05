import { ArrowRight, CalendarCheck, Check, Zap } from "lucide-react";
import { HeroScene } from "./hero-scene";
import { PortalStrip } from "../portal-strip";
import { ContentLink, Lines } from "../content-link";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { SiteContent } from "@/lib/site-content/schema";
import { resolveTokens, tx } from "@/lib/site-content/tokens";

/** Hero: sol metin bloğu + sağ ürün sahnesi. Sunucu bileşeni, istemci JS yok. Metinler site içeriğinden (varsayılan = bugünkü metin). */
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
  const checks = content.checks.filter((c) => !c.hidden).map((c) => ({ id: c.id, ...resolveTokens(c.text, ctx) })).filter((c) => !c.missing);
  return (
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
          {content.integrationBadge || content.integrationLine ? (
            <p className="mk-hero-lead" data-hero-integration="">
              {content.integrationBadge ? <a href="#degerleme" className="mk-tag mk-tag-plan">{tx(content.integrationBadge, ctx)}</a> : null}
              {content.integrationBadge && content.integrationLine ? " " : null}
              {content.integrationLine ? tx(content.integrationLine, ctx) : null}
            </p>
          ) : null}
          <div className="mk-cta-row">
            <ContentLink href={content.primary.href} className="mk-btn mk-btn-grad btn-shine">{tx(content.primary.label, ctx)} <ArrowRight size={18} aria-hidden="true" /></ContentLink>
            <ContentLink href={content.secondary.href} className="mk-btn mk-btn-ghost"><CalendarCheck size={18} aria-hidden="true" />{tx(content.secondary.label, ctx)}</ContentLink>
          </div>
          <ul className="mk-checks">
            {checks.map((c) => <li key={c.id}><Check size={16} aria-hidden="true" />{c.text}</li>)}
          </ul>
        </div>
        <HeroScene />
      </div>
      <PortalStrip />
    </section>
  );
}
