import Link from "next/link";
import { ArrowRight, CalendarCheck, Check, Zap } from "lucide-react";
import { HeroScene } from "./hero-scene";
import { PortalStrip } from "../portal-strip";

/** Hero: sol metin bloğu + sağ ürün sahnesi. Sunucu bileşeni, istemci JS yok. */
export function HeroSection() {
  return (
    <section className="mk-hero" aria-labelledby="hero-baslik">
      <div className="mk-hero-bg" aria-hidden="true" />
      <div className="mk-wrap mk-wrap-wide mk-hero-grid">
        <div className="mk-hero-copy">
          <p className="mk-badge"><Zap size={15} aria-hidden="true" />Emlak ofisleri için işletim sistemi</p>
          <h1 id="hero-baslik" className="mk-h1">
            Emlak işlerinizi <span className="mk-grad">tek platformda</span> yönetin
          </h1>
          <p className="mk-hero-lead">
            Müşteri, talep, portföy, anlaşma ve komisyon akışı tek panelde. Kaçan komisyonu görünür kılan kayıp-kaçak motoru, emsal bazlı değerleme ve 27 otomatik görev ofisinizle birlikte çalışır.
          </p>
          <div className="mk-cta-row">
            <Link href="/kayit" className="mk-btn mk-btn-grad btn-shine">14 gün ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
            <Link href="/demo" className="mk-btn mk-btn-ghost"><CalendarCheck size={18} aria-hidden="true" />Demo görüşmesi planla</Link>
          </div>
          <ul className="mk-checks">
            <li><Check size={16} aria-hidden="true" />Kredi kartı gerekmez</li>
            <li><Check size={16} aria-hidden="true" />Deneme boyunca tüm özellikler açık</li>
            <li><Check size={16} aria-hidden="true" />Taahhüt yok</li>
          </ul>
        </div>
        <HeroScene />
      </div>
      <PortalStrip />
    </section>
  );
}
