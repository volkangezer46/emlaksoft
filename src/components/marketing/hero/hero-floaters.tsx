import { CalendarClock, Radar, Sparkles } from "lucide-react";

/** Cihazın üstüne taşan süzülen rozet kartları. Metinler örnektir; gerçek müşteri/başarı iddiası yok. */
export function HeroFloaters() {
  return (
    <div className="mk-floaters" aria-hidden="true">
      <div className="mk-floater-pos mk-f1">
        <div className="mk-floater">
          <span className="mk-ficon" style={{ background: "rgba(14,159,140,.14)", color: "#0b8172" }}><Sparkles size={16} /></span>
          <span><b>Yeni talep eşleşti</b><span className="mk-sub">3+1 · 2 portföy</span></span>
        </div>
      </div>
      <div className="mk-floater-pos mk-f2">
        <div className="mk-floater">
          <span className="mk-ficon" style={{ background: "rgba(20,99,255,.12)", color: "#0b4fd6" }}><CalendarClock size={16} /></span>
          <span><b>Randevu 14:30</b><span className="mk-sub">Yer gösterme</span></span>
        </div>
      </div>
      <div className="mk-floater-pos mk-f3">
        <div className="mk-floater">
          <span className="mk-ficon" style={{ background: "rgba(207,52,56,.12)", color: "#a92a2e" }}><Radar size={16} /></span>
          <span><b>Komisyon kaybı uyarısı</b><span className="mk-sub">Profesyonel paket</span></span>
        </div>
      </div>
    </div>
  );
}
