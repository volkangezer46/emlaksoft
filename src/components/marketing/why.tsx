import { Check, X } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { withGateBadge } from "@/lib/marketing-plan-badge";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading, SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/**
 * Dürüst karşılaştırma: rakip adı veya rakip iddiası YOK; yalnızca "Excel + WhatsApp + defter" gibi genel eski yöntemle kıyas.
 * Sağ sütun yalnız ürünün bugün yaptığı şeyleri söyler (paket notu sayfa kilidinden). Metinler site içeriğinden.
 */
export async function Why({ heading = defaultSiteContent().sections.neden, content = defaultSiteContent().why }: { heading?: Heading; content?: SiteContent["why"] } = {}) {
  const plans = await getPublicPlanDefinitions();
  const ctx = { plans: [] };
  const ROWS = content.rows.filter((r) => !r.hidden).map((r) => ({ id: r.id, topic: tx(r.topic, ctx), old: tx(r.old, ctx), now: withGateBadge(tx(r.now, ctx), r.gate, plans) }));
  if (ROWS.length === 0) return null;
  return (
    <section id="neden" className="mk-section mk-alt" aria-labelledby="neden-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="neden-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} text={heading.text ? tx(heading.text, { plans: [] }) : undefined} />
        <div className="mk-cmp-wrap mk-reveal">
          <table className="mk-cmp">
            <caption className="sr-only">Genel eski yöntemler ile EmlakSoft karşılaştırması</caption>
            <thead>
              <tr>
                <th scope="col">Konu</th>
                <th scope="col"><span className="mk-cmp-old"><X size={16} aria-hidden="true" />{content.oldLabel}</span></th>
                <th scope="col"><span className="mk-cmp-new"><Check size={16} aria-hidden="true" />{content.newLabel}</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.topic}</th>
                  <td data-label={content.oldLabel}>{r.old}</td>
                  <td data-label={content.newLabel}>{r.now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {content.note ? <p className="mk-fine">{tx(content.note, ctx)}</p> : null}
      </div>
    </section>
  );
}
