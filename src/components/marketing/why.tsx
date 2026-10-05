import { Check, X } from "lucide-react";
import { getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { gateBadge } from "@/lib/marketing-plan-badge";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { Heading } from "@/lib/site-content/schema";
import { tx } from "@/lib/site-content/tokens";
import { RichTitle } from "./content-link";
import { SectionHeading } from "./section-heading";

/**
 * Dürüst karşılaştırma: rakip adı veya rakip iddiası YOK; yalnızca "Excel + WhatsApp + defter" gibi genel eski yöntemle kıyas.
 * Sağ sütun yalnız ürünün bugün yaptığı şeyleri söyler (plans.ts ile uyumlu paket notları).
 */
function buildRows(plans: readonly { id: string; name: string }[]) {
  const at = (path: string) => { const b = gateBadge(path, plans); return b ? ` (${b})` : ""; };
  return [
  { topic: "Müşteri ve talep", old: "Dosyalara ve sohbetlere dağılmış kayıtlar; talep unutulabilir.", now: "Tek müşteri kartı; talep ve portföy eşleşmesi aynı akışta." },
  { topic: "Takip ve hatırlatma", old: "Hatırlatma sizin hafızanızda ve not defterinizde.", now: "Görev ve randevu hatırlatmaları otomatik görevlerle gelir." },
  { topic: "Kaçan fırsat", old: "Bir ilanın neden kaybedildiği çoğu zaman bilinmez.", now: `Zorunlu kapanış formu ve kaçak karnesi${at("/app/kayip-kacak")}.` },
  { topic: "Komisyon", old: "Elle hesap; bölüşümde ve hakedişte tartışma çıkar.", now: "Bölüşüm, hakediş ve onay durumu kayıt altında." },
  { topic: "Ekip erişimi", old: "Dosyaya ulaşan herkes her şeyi görür.", now: "Rol ve izin matrisi; ofis verisi ayrı tutulur." },
  { topic: "Sözleşme ve imza", old: "Kâğıt, fotoğraf ve mesajlaşma ile onay.", now: `SMS onaylı dijital imza akışı${at("/app/sozlesmeler")}.` },
  ];
}

export async function Why({ heading = defaultSiteContent().sections.neden }: { heading?: Heading } = {}) {
  const ROWS = buildRows(await getPublicPlanDefinitions());
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
                <th scope="col"><span className="mk-cmp-old"><X size={16} aria-hidden="true" />Excel + WhatsApp + defter</span></th>
                <th scope="col"><span className="mk-cmp-new"><Check size={16} aria-hidden="true" />EmlakSoft</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.topic}>
                  <th scope="row">{r.topic}</th>
                  <td data-label="Excel + WhatsApp + defter">{r.old}</td>
                  <td data-label="EmlakSoft">{r.now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mk-fine">Karşılaştırma genel çalışma alışkanlıklarını anlatır; belirli bir ürün veya firma ile kıyas değildir.</p>
      </div>
    </section>
  );
}
