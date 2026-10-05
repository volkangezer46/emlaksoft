import { AlertTriangle, CalendarClock, Sparkles } from "lucide-react";
import { HeroDashboard, HeroKpiOverlay, HeroPhoneScreen, HeroSkyline } from "./hero-art";

/**
 * Çok katmanlı ürün sahnesi: şehir silueti, eğik masaüstü paneli, telefon, süzülen cam kartlar, el çizimi not.
 * Hareket: marketing-motion.css tek zaman çizelgesi (.mk-demo; ~14 sn, sonda duraklama); temel CSS = SON KARE. Fare takibi yok.
 * Sunucu bileşeni; oranlar sabit (aspect-ratio) olduğu için CLS=0. Kart ve ekran içeriği ÖRNEK veridir.
 */
export function HeroScene() {
  return (
    <div className="mk-scene mk-demo" role="group" aria-label="Ürün görünümü: örnek ekranlar">
      <div className="mk-scene-sky"><HeroSkyline /></div>

      <svg className="mk-scene-note-arrow" viewBox="0 0 90 70" aria-hidden="true" focusable="false">
        <path d="M6 6 C 8 38, 30 58, 74 60" fill="none" stroke="#3b4a78" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M60 50 L76 60 L58 68" fill="none" stroke="#3b4a78" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="mk-scene-note" aria-hidden="true">Tüm süreçleriniz<br />tek ekranda</p>

      <div className="mk-scene-dash">
        <div className="mk-dash-frame"><HeroDashboard /><HeroKpiOverlay /></div>
      </div>

      <div className="mk-scene-phone">
        <div className="mk-phone">
          <i className="mk-phone-notch" aria-hidden="true" />
          <HeroPhoneScreen />
        </div>
      </div>

      <div className="mk-float mk-float-1">
        <span className="mk-float-ico" style={{ background: "#e6eeff", color: "#1546c2" }}><Sparkles size={18} aria-hidden="true" /></span>
        <span><b>Yeni talep eşleşti</b><small>3 portföy uygun</small></span>
      </div>
      <div className="mk-float mk-float-2">
        <span className="mk-float-ico" style={{ background: "#ffe3e4", color: "#b4232a" }}><AlertTriangle size={18} aria-hidden="true" /></span>
        <span><b>Kayıp komisyon uyarısı</b><small>Kapanış formu bekliyor</small></span>
      </div>
      <div className="mk-float mk-float-3">
        <span className="mk-float-ico" style={{ background: "#fff0d2", color: "#8a5a00" }}><CalendarClock size={18} aria-hidden="true" /></span>
        <span><b>Randevu hatırlatma</b><small>14:30 · yer gösterme</small></span>
      </div>

      <span className="mk-tag mk-example mk-scene-tag">Örnek ekran · örnek veri</span>
    </div>
  );
}
