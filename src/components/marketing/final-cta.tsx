import { ArrowRight, Check, Lock, TrendingUp, type LucideIcon } from "lucide-react";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { SiteContent } from "@/lib/site-content/schema";
import { resolveTokens, tx } from "@/lib/site-content/tokens";
import { ContentLink, Lines, RichTitle } from "./content-link";

const CHECK_ICONS: Record<string, LucideIcon> = { kvkk: Lock, yillik: TrendingUp };

/** Son çağrı. Metin/bağlantılar site içeriğinden; "{yillik}" geçen madde yıllık teklif yoksa gizlenir (metin uydurulmaz). */
export function FinalCta({
  trialDays,
  plans,
  content = defaultSiteContent().finalCta,
}: {
  trialDays?: number;
  plans: readonly PlanDef[];
  content?: SiteContent["finalCta"];
}) {
  const ctx = { trialDays, plans };
  const checks = content.checks.filter((c) => !c.hidden).map((c) => ({ id: c.id, ...resolveTokens(c.text, ctx) })).filter((c) => !c.missing && c.text);
  return (
    <section className="mk-dark mk-final" aria-labelledby="son-cta">
      <div className="mk-grid-bg-dark" aria-hidden="true" />
      <div className="mk-glow-dark" aria-hidden="true" />
      <div className="mk-wrap mk-wrap-final mk-reveal">
        <h2 id="son-cta" className="mk-h2"><RichTitle title={content.title} em={content.em} tail={content.tail} /></h2>
        <p className="mk-lead"><Lines text={tx(content.text, ctx)} /></p>
        <div className="mk-cta-row">
          <ContentLink href={content.primary.href} className="mk-btn mk-btn-light btn-shine">{tx(content.primary.label, ctx)} <ArrowRight size={18} aria-hidden="true" /></ContentLink>
          <ContentLink href={content.secondary.href} className="mk-btn mk-btn-outline-light">{tx(content.secondary.label, ctx)}</ContentLink>
        </div>
        <ul className="mk-final-checks">
          {checks.map((c) => {
            const Icon = CHECK_ICONS[c.id] ?? Check;
            return <li key={c.id}><Icon size={16} aria-hidden="true" />{c.text}</li>;
          })}
        </ul>
      </div>
    </section>
  );
}
