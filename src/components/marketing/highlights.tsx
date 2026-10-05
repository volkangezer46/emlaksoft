import type { ReactNode } from "react";
import { Handshake, RadioTower, ShieldCheck, ToggleRight, Tv } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { gateBadge } from "@/lib/marketing-plan-badge";
import { Em, SectionHeading } from "./section-heading";

/**
 * "Daha fazlası": yalnız sistemde GERÇEKTEN olan beş özellik. Rozetler sayfa kilitlerinden (page-gates) gelir.
 * Küçük önizlemeler CSS ile çizilmiş ÖRNEKTİR (gerçek veri veya canlı sayı iddiası yok); yalnız transform/opacity oynar.
 */
type Item = { id: string; icon: typeof Tv; title: string; text: string; gate?: string; visual?: ReactNode; wide?: boolean };

const ITEMS: Item[] = [
  {
    id: "komisyon", icon: Handshake, title: "Komisyon ve anlaşma omurgası",
    text: "Talep, teklif, sözleşme ve anlaşma aynı kayıtta ilerler; komisyon bölüşümü, hakediş ve onay durumu kayıt altındadır.",
  },
  {
    id: "portallar", icon: RadioTower, title: "Müşteri ve malik portalı",
    text: "Müşteriye ve mülk sahibine özel bağlantıyla açılan sayfalar; ilan, teklif ve randevu durumu tek yerde, hesap açmadan.",
  },
  {
    id: "tv-modu", icon: Tv, title: "Ofis panosu (TV modu)", gate: "/app/pano-tv", wide: true,
    text: "Ofis ekranına yansıtılan pano: günün özeti ve ekip skoru uzaktan okunur boyutta, kendiliğinden tazelenir.",
    visual: (
      <div className="mk-hl-tv" aria-hidden="true">
        <i style={{ "--w": "78%", "--d": "0s" } as React.CSSProperties} />
        <i style={{ "--w": "54%", "--d": "-1.2s" } as React.CSSProperties} />
        <i style={{ "--w": "91%", "--d": "-2.4s" } as React.CSSProperties} />
        <i style={{ "--w": "36%", "--d": "-3.6s" } as React.CSSProperties} />
      </div>
    ),
  },
  {
    id: "moduller", icon: ToggleRight, title: "Modüller: aç, kapa", wide: true,
    text: "Kullanmadığınız alanı ofis ayarlarından kapatın; menü ve ilgili otomasyonlar sadeleşir. Çekirdek alanlar kapatılamaz.",
    visual: (
      <div className="mk-hl-tog" aria-hidden="true">
        <span className="on" /><span /><span className="on" /><span className="on" />
      </div>
    ),
  },
  {
    id: "uyum", icon: ShieldCheck, title: "Telefon ve KVKK uyumu", gate: "/app/uyum",
    text: "Telefonlar ülkesine göre biçimlenir ve sunucuda doğrulanır; yanlış numara kayda girmez. İYS onayı, KVKK silme talepleri ve denetim dosyası bir arada.",
  },
];

export async function Highlights() {
  const plans = await getPublicPlanDefinitions();
  return (
    <section id="diger" className="mk-section" aria-labelledby="diger-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Ayrıntılar" title={<span id="diger-baslik">Günlük işi kolaylaştıran <Em>küçük büyük şeyler.</Em></span>} text="Vitrin, portal ve otomasyonun yanında ofisin her günü kullandığı yardımcı özellikler." />
        <ul className="mk-hl-grid mk-stagger">
          {ITEMS.map((it, i) => {
            const badge = it.gate ? gateBadge(it.gate, plans) : undefined;
            return (
              <li key={it.id} id={it.id} className={`mk-hl${it.wide ? " mk-hl-wide" : ""}`} style={{ "--i": i } as React.CSSProperties}>
                <div className="mk-hl-head">
                  <span className="mk-value-ico mk-tint-blue"><it.icon size={24} aria-hidden="true" /></span>
                  {badge ? <span className="mk-tag mk-tag-plan">{badge}</span> : null}
                </div>
                <h3 className="mk-h3">{it.title}</h3>
                <p>{it.text}</p>
                {it.visual ? <div className="mk-hl-visual">{it.visual}<span className="mk-tag mk-example">Örnek görünüm</span></div> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
