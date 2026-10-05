import { PLANS, type PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { FaqItem, Heading } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { Lines, RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/**
 * Görünen SSS; FAQPage JSON-LD yalnız bu listeden üretilir (landing-jsonld.tsx): sayfa listeyi BİR KEZ üretir ve hem
 * <Faq> hem <LandingJsonLd> aynı diziyi alır. Kaynak: site içeriği (varsayılan = bugünkü sorular); gizlenenler listede yoktur.
 * Deneme günü ve yıllık teklif admin paket tanımlarından (getPublicPricing) {değişken} olarak gelir; sabit yazılmaz.
 * JSON-LD için `faqForJsonLd` kullanılır (cevaptaki satır sonları boşluğa çevrilir).
 */
export function buildHomeFaqs({
  trialDays,
  plans,
  content = defaultSiteContent().faq,
}: {
  trialDays?: number;
  plans: readonly PlanDef[];
  content?: readonly FaqItem[];
}): { q: string; a: string }[] {
  const ctx = { trialDays, plans };
  return content.filter((f) => !f.hidden).map((f) => ({ q: tx(f.q, ctx), a: tx(f.a, ctx) })).filter((f) => f.q && f.a);
}

/** FAQPage JSON-LD için aynı liste: yalnız cevaptaki satır sonları boşluğa çevrilir (metin aynı kalır). */
export function faqForJsonLd(items: readonly { q: string; a: string }[]): { q: string; a: string }[] {
  return items.map((f) => ({ q: f.q, a: f.a.replace(/\s*\n\s*/g, " ") }));
}

/** Yönetim SEO önizlemesi ve sözleşme testi için varsayılan (plans.ts, deneme günü sayısız) SSS; ana sayfa buildHomeFaqs ile canlı veriyle üretir. */
export const FAQS: readonly { q: string; a: string }[] = buildHomeFaqs({ plans: PLANS });

export function Faq({ items, heading = defaultSiteContent().sections.sss }: { items: readonly { q: string; a: string }[]; heading?: Heading }) {
  return (
    <section id="sss" className="mk-section mk-alt" aria-labelledby="sss-baslik">
      <div className="mk-wrap" style={{ maxWidth: "52rem" }}>
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="sss-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} />
        <div className="mk-faq mk-stagger" style={{ marginTop: "2.5rem" }}>
          {items.map((f, i) => (
            <details key={`${i}-${f.q}`} className="motion-details" style={{ "--i": i } as React.CSSProperties}>
              <summary>
                {f.q}
                <i aria-hidden="true" />
              </summary>
              <p><Lines text={f.a} /></p>
            </details>
          ))}
        </div>
        <p style={{ marginTop: "1.5rem", textAlign: "center", fontSize: "0.9375rem", color: "var(--mk-muted)" }}>
          Sorunuz hâlâ mı var? <a href="mailto:destek@emlaksoft.com.tr" style={{ color: "var(--mk-accent-text)", fontWeight: 600 }}>destek@emlaksoft.com.tr</a>
        </p>
      </div>
    </section>
  );
}
