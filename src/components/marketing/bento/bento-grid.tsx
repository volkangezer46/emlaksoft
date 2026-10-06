import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { gateBadge } from "@/lib/marketing-plan-badge";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { BentoTile, Heading, SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "../content-link";
import { SectionHeading } from "../section-heading";
import { AssistantArt, AutomationArt, LeakArt, PortalArt, ShowcaseArt, SignatureArt, TeamArt, ValuationArt } from "./bento-art";

/**
 * Yapı koddadır (kimlik -> ızgara sınıfı, illüstrasyon, koyu zemin, paket rozeti yolu); metinler site içeriğinden
 * (/admin/site-icerik). Paket rozetleri plans.ts / page-gates ile uyumludur. Garanti/ispatsız üstünlük dili yok.
 */
type TileMeta = { id: BentoTile["id"]; cls: string; art: () => ReactNode; gate?: string; dark?: boolean };
/** Kimlik aynı zamanda sayfa içi bağlantı hedefidir (/#kayip-kacak, /#emsal-degerleme ...; site menüsü testi doğrular). */
const TILE_LIST: TileMeta[] = [
  { id: "kayip-kacak", cls: "mk-b-leak", dark: true, gate: "/app/kayip-kacak", art: () => <LeakArt /> },
  { id: "emsal-degerleme", cls: "mk-b-val", art: () => <ValuationArt /> },
  { id: "otomasyon", cls: "mk-b-auto", gate: "/app/otomasyonlar", art: () => <AutomationArt /> },
  { id: "ai-asistan", cls: "mk-b-ai", art: () => <AssistantArt /> },
  { id: "portal-kontrol", cls: "mk-b-portal", gate: "/app/portallar", art: () => <PortalArt /> },
  { id: "imza", cls: "mk-b-sign", gate: "/app/sozlesmeler", art: () => <SignatureArt /> },
  { id: "vitrin", cls: "mk-b-show", art: () => <ShowcaseArt /> },
  { id: "performans", cls: "mk-b-team", gate: "/app/danisman-kpi", art: () => <TeamArt /> },
];
const TILE_META = Object.fromEntries(TILE_LIST.map((t) => [t.id, t])) as Record<BentoTile["id"], TileMeta>;

export async function BentoGrid({ heading = defaultSiteContent().sections.ozellikler, content = defaultSiteContent().bento }: { heading?: Heading; content?: SiteContent["bento"] } = {}) {
  const plans = await getPublicPlanDefinitions();
  const ctx = { plans: [] };
  const TILES = content.tiles
    .filter((t) => !t.hidden)
    .map((t) => {
      const m = TILE_META[t.id];
      const points = t.points.filter((x) => !x.hidden).map((x) => tx(x.text, ctx)).filter(Boolean);
      return { id: t.id, cls: m.cls, dark: m.dark, gate: m.gate, eyebrow: tx(t.eyebrow, ctx), title: tx(t.title, ctx), text: tx(t.text, ctx), points: points.length ? points : undefined, art: m.art() };
    });
  if (TILES.length === 0) return null;
  return (
    <section id="ozellikler" className="mk-section" aria-labelledby="ozellik-baslik">
      <div className="mk-wrap mk-wrap-wide">
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="ozellik-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} text={heading.text ? tx(heading.text, { plans: [] }) : undefined} />
        <div className="mk-bento">
          {TILES.map((t) => (
            <article key={t.id} id={t.id} className={`mk-bcard ${t.cls}${t.dark ? " mk-bcard-dark" : ""} mk-reveal`}>
              <div className="mk-bcard-top">
                <p className="mk-eyebrow">{t.eyebrow}</p>
                {t.gate && gateBadge(t.gate, plans) ? <span className={`mk-tag ${t.dark ? "mk-tag-dark" : "mk-tag-plan"}`}>{gateBadge(t.gate, plans)}</span> : null}
              </div>
              <h3 className="mk-h3">{t.title}</h3>
              <p className="mk-bcard-text">{t.text}</p>
              {t.points ? (
                <ul className="mk-list">
                  {t.points.map((p) => <li key={p}><Check size={16} aria-hidden="true" />{p}</li>)}
                </ul>
              ) : null}
              <div className="mk-b-art">{t.art}</div>
            </article>
          ))}
        </div>
        {content.note ? <p className="mk-fine">{tx(content.note, ctx)}</p> : null}
      </div>
    </section>
  );
}
