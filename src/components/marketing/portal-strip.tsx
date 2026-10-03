import { Link2, ShieldCheck } from "lucide-react";

/**
 * Portal kontrolü şeridi. Markalar LOGO değil nötr metin çipidir; yalnız ilan numarası/URL takibi için adlandırılır.
 * Otomatik yayınlama, veri kazıma veya resmi entegrasyon/ortaklık iddiası YOKTUR.
 */
const PORTALS = ["Sahibinden", "Hepsiemlak", "Zingat", "Emlakjet", "Hürriyet Emlak", "RE/MAX"];

export function PortalStrip() {
  return (
    <div className="mk-wrap">
      <div className="mk-portals">
        <div className="mk-portals-head">
          <h2><Link2 size={18} aria-hidden="true" />Tüm portal ilanları tek ekranda</h2>
          <p>İlan numarasını veya bağlantısını ekleyin; sistem periyodik teyit ister, ilan düşünce kapanış formuyla kaçağı ölçer.</p>
        </div>
        <ul className="mk-chips" aria-label="Takip edebileceğiniz ilan portalları">
          {PORTALS.map((p) => <li key={p}>{p}</li>)}
          <li className="mk-chip-more">+ diğer portallar</li>
        </ul>
        <p className="mk-portals-note"><ShieldCheck size={14} aria-hidden="true" />Marka adları yalnız takip için anılır. Resmi entegrasyon veya ortaklık iddiası yoktur; otomatik yayınlama yapılmaz.</p>
      </div>
    </div>
  );
}
