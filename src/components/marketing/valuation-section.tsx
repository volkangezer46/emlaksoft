import { ArrowRight, Calculator, Check, FileText, Gauge, Layers, MapPinned, Package, X, type LucideIcon } from "lucide-react";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { EfValuationStatus } from "@/lib/site-content/ef-status";
import type { SiteContent } from "@/lib/site-content/schema";
import { resolveTokens, tx } from "@/lib/site-content/tokens";
import { ContentLink, Lines, RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

const ICONS: Record<string, LucideIcon> = { adaparsel: MapPinned, guven: Gauge, pdf: FileText, kontor: Layers, hak: Calculator, paket: Package };

/** "Örnek görünüm": CSS ile çizilmiş yer tutucu. Gerçek veri, sayı veya sonuç iddiası YOKTUR. */
function Mockup() {
  const field = (label: string) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: "0.75rem", color: "var(--mk-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ height: 34, borderRadius: 8, border: "1px solid var(--mk-line)", background: "var(--mk-bg)" }} />
    </div>
  );
  const bar = (w: string) => <div style={{ height: 10, width: w, borderRadius: 6, background: "var(--mk-line)" }} />;
  return (
    <div aria-hidden="true" style={{ position: "relative", background: "var(--mk-card)", border: "1px solid var(--mk-line)", borderRadius: 16, padding: "1.25rem", display: "grid", gap: "1rem" }}>
      <span className="mk-tag mk-example">Örnek görünüm</span>
      <div style={{ display: "flex", gap: 10 }}>
        {field("Mahalle")}
        {field("Ada")}
        {field("Parsel")}
      </div>
      <div style={{ display: "grid", gap: 8, padding: "0.9rem", borderRadius: 12, background: "var(--mk-bg-2)" }}>
        {bar("42%")}
        {bar("68%")}
        {bar("54%")}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ height: 32, flex: 1, borderRadius: 8, background: "var(--mk-line)" }} />
        <div style={{ height: 32, width: 110, borderRadius: 8, background: "var(--mk-blue)", opacity: 0.85 }} />
      </div>
    </div>
  );
}

/**
 * EmlakFiyati entegrasyonlu değerleme bölümü (#degerleme). Metinler site içeriğinden (varsayılan = bu metinler).
 * DÜRÜST DURUM: `status` "live" değilse "Yakında" rozeti ve haber ver/demo CTA'sı; "şimdi deneyin" denmez.
 * "İlk ve tek" iddiası (claims.ts) ayrı cümledir; admin kapatabilir. Sahte sayaç/yorum/rakam yok.
 */
export function ValuationSection({
  status,
  trialDays,
  plans = [],
  content = defaultSiteContent().valuation,
}: {
  status: EfValuationStatus;
  trialDays?: number;
  plans?: readonly PlanDef[];
  content?: SiteContent["valuation"];
}) {
  if (content.hidden) return null;
  const ctx = { trialDays, plans };
  const live = status === "live";
  const points = content.points
    .filter((p) => !p.hidden && ICONS[p.id])
    .map((p) => ({ id: p.id, icon: ICONS[p.id]!, title: tx(p.title, ctx), ...(() => { const r = resolveTokens(p.text, ctx); return { text: r.text, missing: r.missing }; })() }))
    .filter((p) => !p.missing);
  const before = content.compare.before.filter((c) => !c.hidden);
  const after = content.compare.after.filter((c) => !c.hidden);
  const cta = live ? content.liveCta : content.soonCta;
  const badge = live ? content.liveBadge : content.soonBadge;
  return (
    <section id="degerleme" className="mk-section mk-alt" aria-labelledby="degerleme-baslik">
      <div className="mk-wrap mk-wrap-wide">
        <SectionHeading
          center
          eyebrow={content.eyebrow}
          title={<span id="degerleme-baslik"><RichTitle title={content.title} em={content.em} tail={content.tail} /></span>}
          text={content.text ? tx(content.text, ctx) : undefined}
        />
        <p style={{ textAlign: "center", marginTop: "1rem", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.5rem", alignItems: "center" }}>
          {badge ? <span className={`mk-tag ${live ? "mk-tag-plan" : "mk-example"}`} data-ef-status={status}>{badge}</span> : null}
          {content.claim.hidden || !content.claim.text ? null : <strong>{content.claim.text}</strong>}
          {content.claimConcrete ? <span style={{ color: "var(--mk-muted)" }}>{content.claimConcrete}</span> : null}
        </p>
        <div className="mk-split" style={{ marginTop: "2rem", alignItems: "start" }}>
          <ul className="mk-hl-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
            {points.map((p) => (
              <li key={p.id} className="mk-hl">
                <div className="mk-hl-head"><span className="mk-value-ico mk-tint-blue"><p.icon size={24} aria-hidden="true" /></span></div>
                <h3 className="mk-h3">{p.title}</h3>
                <p><Lines text={p.text} /></p>
              </li>
            ))}
          </ul>
          <Mockup />
        </div>
        {before.length || after.length ? (
          <div className="mk-hl-grid" style={{ marginTop: "2rem", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))" }}>
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
        <div className="mk-cta-row" style={{ justifyContent: "center", marginTop: "2rem" }}>
          <ContentLink href={cta.href} className="mk-btn mk-btn-grad btn-shine">{tx(cta.label, ctx)} <ArrowRight size={18} aria-hidden="true" /></ContentLink>
        </div>
        {content.note ? <p className="mk-fine">{tx(content.note, ctx)}</p> : null}
      </div>
    </section>
  );
}
