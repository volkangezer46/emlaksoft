import { BellRing, ChartNoAxesColumn, Rocket, ShieldCheck, Sparkles, Users, type LucideIcon } from "lucide-react";
import { ContentLink } from "./content-link";
import type { PlanDef } from "@/lib/billing/plans";
import { menuIconComponent } from "@/lib/site-menu/icon-registry";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { CardItem } from "@/lib/site-content/schema";
import { toneClass, type CardTone } from "@/lib/site-content/tones";
import { tx } from "@/lib/site-content/tokens";

/**
 * Değer kartları: yalnız gerçek ürün davranışına dayanır. Metin ve bağlantılar site içeriğinden. Bilinen kimlik bugünkü
 * ikon/rengini korur; yönetimden eklenen kart (`c_...`) seçilen ikon/tondan, seçilmemişse varsayılan görünümden çizilir.
 */
const LOOK: Record<string, { icon: LucideIcon; tone: CardTone }> = {
  adim: { icon: Rocket, tone: "emerald" },
  rol: { icon: Users, tone: "violet" },
  kacak: { icon: ChartNoAxesColumn, tone: "amber" },
  veri: { icon: ShieldCheck, tone: "brand" },
  gorev: { icon: BellRing, tone: "rose" },
};
const FALLBACK: { icon: LucideIcon; tone: CardTone } = { icon: Sparkles, tone: "brand" };

export function ValueCards({ trialDays, plans = [], content = defaultSiteContent().valueCards }: { trialDays?: number; plans?: readonly PlanDef[]; content?: readonly CardItem[] }) {
  const ctx = { trialDays, plans };
  return (
    <section aria-label="Öne çıkan değerler" className="mk-wrap mk-values-wrap">
      <ul className="mk-values">
        {content.filter((c) => !c.hidden).map((c) => {
          const base = (Object.hasOwn(LOOK, c.id) ? LOOK[c.id] : undefined) ?? FALLBACK;
          const Icon = (c.icon ? menuIconComponent(c.icon) : null) ?? base.icon;
          return (
            <li key={c.id}>
              <ContentLink href={c.href} className="mk-value">
                <span className={`mk-value-ico ${toneClass(c.tone ?? base.tone)}`}><Icon size={24} aria-hidden="true" /></span>
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
