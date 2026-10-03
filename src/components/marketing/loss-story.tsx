import { Check } from "lucide-react";
import { Em } from "./section-heading";

/**
 * Kayıp-kaçak hikâyesi (koyu bant, ikinci imza an). Rakam/tutar YOK: yalnız anlaşma zaman çizgisi ve
 * kırmızı kayıp dalı. Kayıp-kaçak motoru yalnız Profesyonel pakettedir (plans.ts).
 */
const STOPS = [
  { x: 60, label: "Talep" },
  { x: 210, label: "Gösterim" },
  { x: 360, label: "Teklif" },
  { x: 510, label: "Kapanış" },
];

export function LossStory() {
  return (
    <section id="kayip-kacak" className="mk-dark mk-section" aria-labelledby="kayip-baslik">
      <div className="mk-grid-bg-dark" aria-hidden="true" />
      <div className="mk-glow-dark" aria-hidden="true" />
      <div className="mk-wrap">
        <div className="mk-split">
          <div className="mk-reveal">
            <p className="mk-eyebrow" style={{ color: "#ffb3b5" }}>Kayıp-kaçak motoru</p>
            <h2 id="kayip-baslik" className="mk-h2" style={{ marginTop: "1rem" }}>Kaybettiğiniz komisyonu <Em>rakama dökün.</Em></h2>
            <p className="mk-lead" style={{ marginTop: "1rem" }}>
              İlan yayından kalktığında sistem sebebini sorar: satıldı mı, rakip mi kapattı, yoksa ihmal mi edildi? Kaçan komisyon görünür olur.
            </p>
            <ul className="mk-list">
              {["Zorunlu kapanış formu, boş geçilemez", "Rakip kapanışı ile kendi satışınız ayrı sayılır", "Danışman bazında kaçak karnesi"].map((t) => (
                <li key={t}><Check size={18} color="#8fe3d3" aria-hidden="true" />{t}</li>
              ))}
            </ul>
            <p className="mk-note"><span className="mk-tag mk-tag-dark">Yalnız Profesyonel pakette</span></p>
          </div>

          <div className="mk-glass mk-timeline mk-reveal">
            <svg className="mk-svg" viewBox="0 0 560 340" role="img" aria-label="Örnek anlaşma zaman çizgisi: talep, gösterim, teklif ve kapanış durakları; teklif aşamasından ayrılan kırmızı kesik yol komisyon kayıp riskini gösterir">
              <path d="M60 130 H510" stroke="#6d86b0" strokeWidth="3" strokeLinecap="round" />
              <path className="mk-draw-in" pathLength="1" d="M360 130 C400 130 400 250 450 250" fill="none" stroke="#ff6b70" strokeWidth="3" strokeLinecap="round" strokeDasharray="1" />
              <g transform="translate(450 250)">
                <circle r="14" fill="#cf3438" />
                <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
              </g>
              <rect x="300" y="276" width="230" height="36" rx="18" fill="rgba(207,52,56,.2)" stroke="#ff6b70" strokeOpacity="0.6" />
              <text x="415" y="299" textAnchor="middle" fontSize="14" fontWeight="600" fill="#ffd0d1">Komisyon kayıp riski</text>
              {STOPS.map((s, i) => (
                <g key={s.label}>
                  <circle cx={s.x} cy="130" r="16" fill="#0a2247" stroke={i === 3 ? "#8fe3d3" : "#8fb4ff"} strokeWidth="3" />
                  <circle cx={s.x} cy="130" r="6" fill={i === 3 ? "#8fe3d3" : "#8fb4ff"} />
                  <text x={s.x} y="82" textAnchor="middle" fontSize="15" fontWeight="600" fill="#fff">{s.label}</text>
                </g>
              ))}
            </svg>
            <p style={{ margin: "0.5rem 0 0" }}><span className="mk-tag mk-tag-dark">Örnek ekran · örnek veri</span></p>
          </div>
        </div>
      </div>
    </section>
  );
}
