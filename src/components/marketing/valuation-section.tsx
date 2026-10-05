import { ArrowRight, Calculator, Check, FileText, Gauge, Layers, MapPinned, Package, X, type LucideIcon } from "lucide-react";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { EfValuationStatus } from "@/lib/site-content/ef-status";
import type { SiteContent } from "@/lib/site-content/schema";
import { resolveTokens, tx } from "@/lib/site-content/tokens";
import { ContentLink, Lines, RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";
import { ExampleReport } from "./example-report";
import type { EfPublicState } from "@/lib/ef-credits/public-state-core";

const ICONS: Record<string, LucideIcon> = { adaparsel: MapPinned, guven: Gauge, pdf: FileText, kontor: Layers, hak: Calculator, paket: Package };

/**
 * EmlakFiyati entegrasyonlu değerleme bölümü (#degerleme). Metinler site içeriğinden (varsayılan = bu metinler).
 * DÜRÜST DURUM: `status` "live" değilse "Yakında" rozeti ve haber ver/demo CTA'sı; "şimdi deneyin" denmez.
 * "İlk ve tek" iddiası (claims.ts) ayrı cümledir; admin kapatabilir. Sahte sayaç/yorum/rakam yok.
 */
export function ValuationSection({
  status,
  state,
  trialDays,
  plans = [],
  content = defaultSiteContent().valuation,
}: {
  status: EfValuationStatus;
  /** Ayrıntılı durum: stale/maintenance iken rozet Bakımda; verilmezse status'tan türer. */
  state?: EfPublicState;
  trialDays?: number;
  plans?: readonly PlanDef[];
  content?: SiteContent["valuation"];
}) {
  if (content.hidden) return null;
  const live = status === "live";
  const ctx = { trialDays, plans, efLive: live };
  const points = content.points
    .filter((p) => !p.hidden && ICONS[p.id])
    .map((p) => ({ id: p.id, icon: ICONS[p.id]!, title: tx(p.title, ctx), ...(() => { const r = resolveTokens(p.text, ctx); return { text: r.text, missing: r.missing }; })() }))
    .filter((p) => !p.missing);
  const before = content.compare.before.filter((c) => !c.hidden);
  const after = content.compare.after.filter((c) => !c.hidden);
  const cta = live ? content.liveCta : content.soonCta;
  const badge = live ? content.liveBadge : state === "maintenance" || state === "stale" ? "Bakımda" : content.soonBadge;
  return (
    <section id="degerleme" className="mk-section mk-alt" aria-labelledby="degerleme-baslik">
      <div className="mk-wrap mk-wrap-wide">
        <SectionHeading
          center
          eyebrow={content.eyebrow}
          title={<span id="degerleme-baslik"><RichTitle title={content.title} em={content.em} tail={content.tail} /></span>}
          text={content.text ? tx(content.text, ctx) : undefined}
        />
        <p className="mk-val-claim">
          {badge ? <span className={`mk-tag ${live ? "mk-tag-plan" : "mk-example"}`} data-ef-status={status}>{badge}</span> : null}
          {content.claim.hidden || !content.claim.text ? null : <strong>{content.claim.text}</strong>}
          {content.claimConcrete ? <span className="mk-val-concrete">{content.claimConcrete}</span> : null}
        </p>
        <div className="mk-split mk-val-split">
          <ul className="mk-hl-grid mk-val-points">
            {points.map((p) => (
              <li key={p.id} className="mk-hl">
                <div className="mk-hl-head"><span className="mk-value-ico mk-tint-blue"><p.icon size={24} aria-hidden="true" /></span></div>
                <h3 className="mk-h3">{p.title}</h3>
                <p><Lines text={p.text} /></p>
              </li>
            ))}
          </ul>
          <ExampleReport className="mk-val-aside" />
        </div>
        {before.length || after.length ? (
          <div className="mk-hl-grid mk-val-compare">
            <div className="mk-hl">
              <h3 className="mk-h3">{content.compare.beforeTitle}</h3>
              <ul className="mk-list">{before.map((c) => <li key={c.id}><X size={16} aria-hidden="true" />{tx(c.text, ctx)}</li>)}</ul>
            </div>
            <div className="mk-hl">
              <h3 className="mk-h3">{content.compare.afterTitle}</h3>
              <ul className="mk-list">{after.map((c) => <li key={c.id}><Check size={16} aria-hidden="true" />{tx(c.text, ctx)}</li>)}</ul>
            </div>
          </div>
        ) : null}
        <div className="mk-cta-row mk-cta-center">
          <ContentLink href={cta.href} className="mk-btn mk-btn-grad btn-shine">{tx(cta.label, ctx)} <ArrowRight size={18} aria-hidden="true" /></ContentLink>
        </div>
        {content.note ? <p className="mk-fine">{tx(content.note, ctx)}</p> : null}
      </div>
    </section>
  );
}
