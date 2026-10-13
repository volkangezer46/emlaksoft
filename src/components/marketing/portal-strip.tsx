import { Link2 } from "lucide-react";
import { SpriteIcon } from "@/components/icons/sprite-icon";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import type { PortalStripContent } from "@/lib/site-content/schema";

/**
 * Portal kontrolü şeridi. Markalar LOGO değil nötr metin çipidir; yalnız ilan numarası/URL takibi için adlandırılır.
 * Otomatik yayınlama, veri kazıma veya resmi entegrasyon/ortaklık iddiası YOKTUR.
 * Metin ve portal listesi site içeriğinden (Yönetim > Site içeriği > Ana başlık > Portal şeridi); hukuki itirazda tek tıkla
 * gizlenir (`hidden`). Varsayılan = eski gömülü metin; DOM yapısı ve sınıflar değişmez. Metinler çağıranda çözülür.
 */
export function PortalStrip({ content = defaultSiteContent().hero.portalStrip }: { content?: PortalStripContent }) {
  if (content.hidden) return null;
  return (
    <div className="mk-wrap">
      <div className="mk-portals">
        <div className="mk-portals-head">
          <h2><Link2 size={18} aria-hidden="true" />{content.title}</h2>
          <p>{content.text}</p>
        </div>
        <ul className="mk-chips" aria-label="Takip edebileceğiniz ilan portalları">
          {content.portals.map((p, i) => <li key={`${i}-${p.name}`}>{p.name}</li>)}
          <li className="mk-chip-more">+ diğer portallar</li>
        </ul>
        <p className="mk-portals-note"><SpriteIcon name="shield-check" size={14} />{content.note}</p>
      </div>
    </div>
  );
}
