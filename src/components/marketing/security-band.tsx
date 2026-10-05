import { KeyRound, Lock, Scale, Users } from "lucide-react";
import type { PlanDef } from "@/lib/billing/plans";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading, SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { Lines, RichTitle } from "./content-link";

/* Garanti dili YOK: "süreç desteği". Metinler site içeriğinden (varsayılan = bugünkü metin); ikon kimliğe bağlıdır. */
const ICONS: Record<string, typeof Lock> = { veri: Lock, yetki: KeyRound, rol: Users, kvkk: Scale };

function Shield() {
  return (
    <svg className="mk-shield" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      {[190, 150, 110].map((r, i) => (
        <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#8fb4ff" strokeOpacity={0.14 + i * 0.08} strokeWidth="1.5" strokeDasharray={i === 1 ? "4 8" : undefined} />
      ))}
      <path d="M200 96 L276 124 V198 C276 244 244 274 200 296 C156 274 124 244 124 198 V124 Z" fill="rgba(20,99,255,.22)" stroke="#8fb4ff" strokeWidth="3" strokeLinejoin="round" />
      <rect x="170" y="186" width="60" height="48" rx="10" fill="#071a38" stroke="#8fe3d3" strokeWidth="3" />
      <path d="M182 186 V170 C182 156 190 148 200 148 C210 148 218 156 218 170 V186" fill="none" stroke="#8fe3d3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="200" cy="210" r="6" fill="#8fe3d3" />
    </svg>
  );
}

export function SecurityBand({
  trialDays,
  plans = [],
  content = defaultSiteContent().security,
  heading = defaultSiteContent().sections.guvenlik,
}: {
  trialDays?: number;
  plans?: readonly PlanDef[];
  content?: SiteContent["security"];
  heading?: Heading;
}) {
  const ctx = { trialDays, plans };
  const items = content.items.filter((i) => !i.hidden && ICONS[i.id]).map((i) => ({ ...i, icon: ICONS[i.id]! }));
  const chips = content.chips.filter((c) => !c.hidden);
  return (
    <section id="guvenlik" className="mk-dark mk-section" aria-labelledby="guvenlik-baslik" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <div className="mk-grid-bg-dark" aria-hidden="true" />
      <div className="mk-glow-dark" aria-hidden="true" />
      <div className="mk-wrap">
        <div className="mk-split">
          <div className="mk-reveal">
            <p className="mk-eyebrow">{heading.eyebrow}</p>
            <h2 id="guvenlik-baslik" className="mk-h2" style={{ marginTop: "1rem" }}><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></h2>
            <ul className="mk-chips mk-chips-dark" aria-label="Güvenlik başlıkları">
              {chips.map((c) => <li key={c.id}>{tx(c.text, ctx)}</li>)}
            </ul>
            <ul className="mk-sec-items">
              {items.map((it) => (
                <li key={it.id}>
                  <span className="mk-sec-ico"><it.icon size={20} aria-hidden="true" /></span>
                  <div>
                    <h3 className="mk-h3">{tx(it.title, ctx)}</h3>
                    <p><Lines text={tx(it.text, ctx)} /></p>
                  </div>
                </li>
              ))}
            </ul>
            {content.note ? <p className="mk-note">{tx(content.note, ctx)}</p> : null}
          </div>
          <div className="mk-reveal"><Shield /></div>
        </div>
      </div>
    </section>
  );
}
