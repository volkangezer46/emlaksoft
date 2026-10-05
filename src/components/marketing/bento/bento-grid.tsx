import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { gateBadge } from "@/lib/marketing-plan-badge";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "../content-link";
import { SectionHeading } from "../section-heading";
import { AssistantArt, AutomationArt, LeakArt, PortalArt, ShowcaseArt, SignatureArt, TeamArt, ValuationArt } from "./bento-art";

type Tile = { id: string; cls: string; eyebrow: string; title: string; text: string; gate?: string; points?: string[]; art: ReactNode; dark?: boolean };

/* Paket rozetleri plans.ts ile uyumludur: kayıp-kaçak, KPI/lig ve otomasyon kuralları Profesyonel; portal teyit ve
   dijital imza Ofis ve üstü. Garanti/ispatsız üstünlük dili yok. */
const TILES: Tile[] = [
  {
    id: "kayip-kacak", cls: "mk-b-leak", dark: true, eyebrow: "Kayıp-kaçak kalkanı", title: "Kaybettiğiniz komisyonu rakama dökün", gate: "/app/kayip-kacak",
    text: "İlan yayından kalktığında sistem sebebini sorar: satıldı mı, rakip mi kapattı, yoksa ihmal mi edildi? Kaçan komisyon görünür olur.",
    points: ["Zorunlu kapanış formu, boş geçilemez", "Rakip kapanışı ile kendi satışınız ayrı sayılır", "Danışman bazında kaçak karnesi"], art: <LeakArt />,
  },
  { id: "emsal-degerleme", cls: "mk-b-val", eyebrow: "Değerleme", title: "Emsal bazlı fiyat sinyali", text: "Emsal motoru benzer portföylerden bir fiyat aralığı çıkarır; pazarlığa veriyle girersiniz.", art: <ValuationArt /> },
  { id: "otomasyon", cls: "mk-b-auto", eyebrow: "Otomasyonlar", title: "27 otomatik görev, arka planda", gate: "/app/otomasyonlar", text: "Hatırlatma, teyit ve özet işleri siz uğraşmadan zamanında çalışır.", art: <AutomationArt /> },
  { id: "ai-asistan", cls: "mk-b-ai", eyebrow: "AI asistan", title: "Sorun, listelesin", text: "Doğal dille sorun; asistan ofis kayıtlarınız üzerinden yanıtlar.", art: <AssistantArt /> },
  { id: "portal-kontrol", cls: "mk-b-portal", eyebrow: "Portal kontrolü", title: "İlanlarınızı teyitle, kaçağı ölçün", gate: "/app/portallar", text: "İlan numarası veya bağlantısını ekleyin; periyodik teyit ve kapanış formu. Otomatik yayınlama yoktur.", art: <PortalArt /> },
  { id: "imza", cls: "mk-b-sign", eyebrow: "Sözleşme", title: "SMS onaylı dijital imza", gate: "/app/sozlesmeler", text: "Teklif ve sözleşme aynı kayıtta; imza SMS doğrulamasıyla alınır.", art: <SignatureArt /> },
  { id: "vitrin", cls: "mk-b-show", eyebrow: "Vitrin", title: "Kendi adresinizde ofis vitrini", text: "Portföyleriniz, favoriler ve değerleme formuyla herkese açık sayfa.", art: <ShowcaseArt /> },
  { id: "performans", cls: "mk-b-team", eyebrow: "Ekip ve performans", title: "Karne, lig ve hedefler", gate: "/app/danisman-kpi", text: "Danışman KPI, ekip ligi ve hedefler tek yerde; ekibi sayılarla yönetin.", art: <TeamArt /> },
];

export async function BentoGrid({ heading = defaultSiteContent().sections.ozellikler }: { heading?: Heading } = {}) {
  const plans = await getPublicPlanDefinitions();
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
        <p className="mk-fine">
          İllüstrasyonlardaki isim ve sayılar örnek veridir. Özelliklerin kapsamı pakete göre değişir; deneme boyunca hepsi açıktır.
        </p>
      </div>
    </section>
  );
}
