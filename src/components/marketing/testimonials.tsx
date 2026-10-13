import { Quote } from "lucide-react";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { SiteContent } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { Lines, RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/**
 * Kanıtlı müşteri yorumları: YALNIZ yazılı onayı (tarih + kaynak, şemada zorunlu) olan gerçek kişiler. Saf sunucu HTML'i,
 * istemci kodu/adacık yok. PUAN YOK ve AggregateRating/Review yapılandırılmış verisi ÜRETİLMEZ (sahte/doğrulanamaz yıldız riski).
 * Görünen yorum yoksa bölüm düzende açık olsa bile çizilmez. Onay tarihi/kaynağı iç kanıttır, sayfada gösterilmez.
 */
export function Testimonials({ content = defaultSiteContent().testimonials }: { content?: SiteContent["testimonials"] } = {}) {
  const items = content.items.filter((t) => !t.hidden);
  if (items.length === 0) return null;
  const heading = content.heading;
  const ctx = { plans: [] };
  return (
    <section id="musteri-yorumlari" className="mk-section mk-alt" aria-labelledby="musteri-yorumlari-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow={heading.eyebrow} title={<span id="musteri-yorumlari-baslik"><RichTitle title={heading.title} em={heading.em} tail={heading.tail} /></span>} text={heading.text ? tx(heading.text, ctx) : undefined} />
        <ul className="mk-hl-grid mk-stagger">
          {items.map((t, i) => {
            const who = [t.role, t.office, t.city].filter(Boolean).join(" · ");
            return (
              <li key={t.id} className="mk-hl" style={{ "--i": i } as React.CSSProperties}>
                <figure>
                  <div className="mk-hl-head">
                    <span className="mk-value-ico mk-tint-blue"><Quote size={22} aria-hidden="true" /></span>
                  </div>
                  <blockquote><p><Lines text={t.quote} /></p></blockquote>
                  <figcaption>
                    <b>{t.name}</b>
                    {who ? <small> · {who}</small> : null}
                  </figcaption>
                </figure>
              </li>
            );
          })}
        </ul>
        <p className="mk-fine">Yorumlar, sahiplerinin yazılı onayıyla yayınlanır.</p>
      </div>
    </section>
  );
}
