import { Building2, CalendarClock, Handshake, Search, Users } from "lucide-react";
import { Em } from "./section-heading";

/**
 * Akıllı arama: panelde gerçekten var olan davranış — Ctrl/Cmd+K komut paleti ve "g" + harf ile sayfa
 * geçişi (keyboard-shortcuts.tsx). Sonuç satırları örnektir.
 */
const ROWS = [
  { icon: Users, label: "Müşteriler", keys: ["G", "M"], on: true },
  { icon: Building2, label: "Portföyler", keys: ["G", "P"], on: false },
  { icon: Handshake, label: "Anlaşmalar", keys: ["G", "A"], on: false },
  { icon: CalendarClock, label: "Randevular", keys: ["G", "R"], on: false },
];

export function CommandPaletteArt() {
  return (
    <section id="akilli-arama" className="mk-section" aria-labelledby="arama-baslik">
      <div className="mk-wrap">
        <div className="mk-split mk-split-rev">
          <div className="mk-reveal" style={{ order: 2 }}>
            <p className="mk-eyebrow">Akıllı arama</p>
            <h2 id="arama-baslik" className="mk-h2" style={{ marginTop: "1rem" }}>Aradığınıza <Em>iki tuşla</Em> gidin.</h2>
            <p className="mk-lead" style={{ marginTop: "1rem" }}>
              <kbd className="mk-kbd">Ctrl</kbd> <kbd className="mk-kbd">K</kbd> ile müşteri, portföy ve kayıtlarda arayın; <kbd className="mk-kbd">G</kbd> ardından bir harfle ilgili sayfaya geçin. Yazı yazarken kısayollar devre dışıdır.
            </p>
          </div>
          <div className="mk-palette mk-reveal" style={{ order: 1 }} aria-label="Komut paleti örnek ekranı" role="img">
            <div className="mk-pal-in"><Search size={18} aria-hidden="true" /> Ara veya bir sayfaya git…<kbd className="mk-kbd">Ctrl K</kbd></div>
            <div className="mk-pal-grp">Sayfaya git</div>
            {ROWS.map((r) => (
              <div key={r.label} className={`mk-pal-row${r.on ? " mk-on" : ""}`}>
                <span className="mk-pal-ico"><r.icon size={16} aria-hidden="true" /></span>
                {r.label}
                <span className="mk-keys">{r.keys.map((k) => <kbd key={k} className="mk-kbd">{k}</kbd>)}</span>
              </div>
            ))}
            <div className="mk-pal-foot"><span>Örnek ekran</span><span style={{ marginLeft: "auto" }}>Enter ile aç</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
