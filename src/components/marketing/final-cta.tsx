import Link from "next/link";
import { ArrowRight, Check, Lock, TrendingUp } from "lucide-react";
import { Em } from "./section-heading";

export function FinalCta() {
  return (
    <section className="mk-dark mk-final" aria-labelledby="son-cta">
      <div className="mk-grid-bg-dark" aria-hidden="true" />
      <div className="mk-glow-dark" aria-hidden="true" />
      <div className="mk-wrap" style={{ maxWidth: "52rem" }}>
        <h2 id="son-cta" className="mk-h2">Ofisinizde kaybolan fırsatları <Em>bugün görün.</Em></h2>
        <p className="mk-lead" style={{ marginTop: "1rem" }}>14 gün ücretsiz, kredi kartı gerekmez. Verileriniz size ait; istediğiniz an dışa aktarın.</p>
        <div className="mk-cta-row">
          <Link href="/kayit" className="mk-btn mk-btn-light btn-shine">14 gün ücretsiz dene <ArrowRight size={18} aria-hidden="true" /></Link>
          <Link href="/demo" className="mk-btn mk-btn-outline-light">Demo görüşmesi planla</Link>
        </div>
        <ul className="mk-final-checks">
          <li><Lock size={16} aria-hidden="true" />KVKK süreç desteği</li>
          <li><TrendingUp size={16} aria-hidden="true" />Yıllık ödemede %20 indirim</li>
          <li><Check size={16} aria-hidden="true" />Taahhütsüz</li>
        </ul>
      </div>
    </section>
  );
}
