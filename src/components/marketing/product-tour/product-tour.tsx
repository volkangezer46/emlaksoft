import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { withGateBadge } from "@/lib/marketing-plan-badge";
import { DeviceFrame } from "../device-frame";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading, TourItem } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "../content-link";
import { SectionHeading } from "../section-heading";
import { AutomationScreen, CommissionScreen, CustomersScreen, DealsScreen, PortfolioScreen, ReportsScreen, TodayScreen } from "./screens";

/**
 * JS'siz ürün turu: radyo girdileri + kardeş seçiciler (marketing-sections.css). Tüm ekranlar DOM'dadır (SEO),
 * biri görünür. Oklar radyo grubunda yerel olarak gezinir. Metinler site içeriğinden (yönetim: /admin/site-icerik);
 * ekran çizimi sekme kimliğinden seçilir, paket rozeti sayfa kilidinden (gateBadge) eklenir. Radyo/ekran sınıfı
 * SIRAYA göredir (tt1..tt7), böylece sıralama/gizleme CSS'i bozmaz.
 */
const SCREENS: Record<TourItem["id"], () => ReactNode> = {
  bugun: () => <TodayScreen />,
  musteriler: () => <CustomersScreen />,
  portfoy: () => <PortfolioScreen />,
  anlasmalar: () => <DealsScreen />,
  komisyon: () => <CommissionScreen />,
  raporlar: () => <ReportsScreen />,
  otomasyon: () => <AutomationScreen />,
};

export async function ProductTour({ heading = defaultSiteContent().sections.tur, items = defaultSiteContent().tour }: { heading?: Heading; items?: readonly TourItem[] } = {}) {
  const plans = await getPublicPlanDefinitions();
  const ctx = { plans: [] };
  const TABS = items
    .filter((t) => !t.hidden)
    .map((t, i) => ({
      id: String(i + 1),
      label: t.label,
      text: tx(t.text, ctx),
      points: t.points.filter((x) => !x.hidden).map((x) => withGateBadge(tx(x.text, ctx), x.gate, plans)).filter(Boolean),
      screen: SCREENS[t.id](),
    }));
  if (TABS.length === 0) return null;
  return (
    <section id="tur" className="mk-section mk-alt" aria-labelledby="tur-baslik">
      <div className="mk-wrap mk-wrap-wide">
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="tur-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} text={heading.text ? tx(heading.text, { plans: [] }) : undefined} />
        <fieldset className="mk-tour mk-reveal">
          <legend className="sr-only">Ürün turu ekranı seçin</legend>
          {TABS.map((t, i) => (
            <input key={t.id} type="radio" name="urun-turu" id={`tt${t.id}`} defaultChecked={i === 0} aria-label={t.label} />
          ))}
          <div className="mk-tour-tabs">
            {TABS.map((t) => (
              <label key={t.id} htmlFor={`tt${t.id}`}>{t.label}</label>
            ))}
          </div>
          <div className="mk-tour-screens">
            {TABS.map((t) => (
              <div key={t.id} className={`mk-scr mk-s${t.id}`}>
                <div className="mk-scr-cap">
                  <h3 className="mk-h3">{t.label}</h3>
                  <p>{t.text}</p>
                  <ul>
                    {t.points.map((p) => (
                      <li key={p}><Check size={16} aria-hidden="true" />{p}</li>
                    ))}
                  </ul>
                </div>
                <DeviceFrame label={`EmlakSoft · ${t.label}`}>{t.screen}</DeviceFrame>
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
