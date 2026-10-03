import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { DeviceFrame } from "../device-frame";
import { Em } from "../section-heading";
import { HeroDevice } from "./hero-device";
import { HeroFloaters } from "./hero-floaters";

export function HeroSection() {
  return (
    <section className="mk-hero" aria-labelledby="hero-title">
      <div className="mk-grid-bg" aria-hidden="true" />
      <div className="mk-glow" aria-hidden="true" />
      <div className="mk-wrap mk-wrap-wide">
        <div className="mk-hero-copy">
          <p className="mk-pill"><i aria-hidden="true" />Emlak ofisleri için tek panel</p>
          <h1 id="hero-title" className="mk-h1">
            Emlak ofisinizin tüm işi, <Em>tek ekranda.</Em>
          </h1>
          <p className="mk-lead">
            Müşteri, portföy, randevu, anlaşma ve komisyon tek panelde. Kayıp komisyonunuzu rakamla görün.
          </p>
          <div className="mk-cta-row">
            <Link href="/kayit" className="mk-btn mk-btn-primary btn-shine">
              14 gün ücretsiz dene <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/demo" className="mk-btn mk-btn-ghost">Demo görüşmesi planla</Link>
          </div>
          <ul className="mk-checks">
            {["Kredi kartı gerekmez", "Taahhütsüz", "Deneme boyunca tüm özellikler açık"].map((t) => (
              <li key={t}><Check size={16} aria-hidden="true" />{t}</li>
            ))}
          </ul>
        </div>

        <div className="mk-hero-stage">
          <div className="mk-device-wrap">
            <DeviceFrame label="EmlakSoft · Bugün" crop>
              <HeroDevice />
            </DeviceFrame>
          </div>
          <HeroFloaters />
        </div>
      </div>
    </section>
  );
}
