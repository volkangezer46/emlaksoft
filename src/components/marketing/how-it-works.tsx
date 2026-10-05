import { LineChart, Settings2, UserPlus, type LucideIcon } from "lucide-react";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading, TextItem } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { Lines, RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/* Adımlar kayıt akışı ve kurulum sihirbazıyla uyumludur; süre sözü verilmez. Metinler site içeriğinden, ikon kimliğe bağlı. */
const ICONS: Record<string, LucideIcon> = { hesap: UserPlus, ofis: Settings2, izle: LineChart };

export function HowItWorks({
  trialDays,
  plans = [],
  steps = defaultSiteContent().steps,
  heading = defaultSiteContent().sections.nasil,
}: {
  trialDays?: number;
  plans?: readonly PlanDef[];
  steps?: readonly TextItem[];
  heading?: Heading;
}) {
  const ctx = { trialDays, plans };
  const STEPS = steps.filter((s) => !s.hidden && ICONS[s.id]).map((s) => ({ ...s, icon: ICONS[s.id]! }));
  return (
    <section id="nasil" className="mk-section" aria-labelledby="nasil-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="nasil-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} text={heading.text ? tx(heading.text, ctx) : undefined} />
        <ol className="mk-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className="mk-step mk-reveal" style={{ "--i": i } as React.CSSProperties}>
              <span className="mk-step-n" aria-hidden="true">{i + 1}</span>
              <span className="mk-step-ico"><s.icon size={26} aria-hidden="true" /></span>
              <h3 className="mk-h3">{tx(s.title, ctx)}</h3>
              <p><Lines text={tx(s.text, ctx)} /></p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
