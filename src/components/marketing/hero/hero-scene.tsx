import { AlertTriangle, CalendarClock, Sparkles } from "lucide-react";
import { HeroDashboard, HeroKpiOverlay, HeroPhoneScreen, HeroSkyline } from "./hero-art";

/**
 * Çok katmanlı ürün sahnesi: şehir silueti, eğik masaüstü paneli (v4 ana ekran taklidi), telefon, süzülen kartlar.
 * El yazısı not ve Caveat web fontu kaldırıldı (v4: sade dil; hero ek font indirmez).
 * Hareket: marketing-motion.css tek zaman çizelgesi (.mk-demo; ~14 sn, sonda duraklama); temel CSS = SON KARE. Fare takibi yok.
 * Sunucu bileşeni; oranlar sabit (aspect-ratio) olduğu için CLS=0. Kart ve ekran içeriği ÖRNEK veridir.
 */
export function HeroScene() {
  return (
    <div className="mk-scene mk-demo" role="group" aria-label="Ürün görünümü: örnek ekranlar">
      <div className="mk-scene-sky"><HeroSkyline /></div>

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
        <span className="mk-float-ico" style={{ background: "#fbf0d6", color: "#7a5200" }}><CalendarClock size={18} aria-hidden="true" /></span>
        <span><b>Randevu hatırlatma</b><small>14:30 · yer gösterme</small></span>
      </div>

    </div>
  );
}
