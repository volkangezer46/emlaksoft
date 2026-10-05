import { BellRing, ChartNoAxesColumn, Rocket, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import { ContentLink } from "./content-link";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { CardItem } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";

/** Beş değer kartı: yalnız gerçek ürün davranışına dayanır. Metin ve bağlantılar site içeriğinden; ikon/renk kimliğe bağlıdır. */
const LOOK: Record<string, { icon: LucideIcon; tint: string }> = {
  adim: { icon: Rocket, tint: "mint" },
  rol: { icon: Users, tint: "violet" },
  kacak: { icon: ChartNoAxesColumn, tint: "amber" },
  veri: { icon: ShieldCheck, tint: "blue" },
  gorev: { icon: BellRing, tint: "rose" },
};

export function ValueCards({ trialDays, plans = [], content = defaultSiteContent().valueCards }: { trialDays?: number; plans?: readonly PlanDef[]; content?: readonly CardItem[] }) {
  const ctx = { trialDays, plans };
  return (
    <section aria-label="Öne çıkan değerler" className="mk-wrap mk-values-wrap">
      <ul className="mk-values">
        {content.filter((c) => !c.hidden && LOOK[c.id]).map((c) => {
          const look = LOOK[c.id]!;
          return (
            <li key={c.id}>
              <ContentLink href={c.href} className="mk-value">
                <span className={`mk-value-ico mk-tint-${look.tint}`}><look.icon size={24} aria-hidden="true" /></span>
                <span>
                  <b>{tx(c.title, ctx)}</b>
                  <small>{tx(c.text, ctx)}</small>
                </span>
              </ContentLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
