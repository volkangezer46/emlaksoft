import { Em, SectionHeading } from "./section-heading";

/* Adımlar kayıt akışı ve kurulum sihirbazıyla uyumludur; süre sözü verilmez. Mini illüstrasyonlar örnektir. */
const STEPS = [
  { title: "Hesabınızı açın", text: "14 gün ücretsiz, kredi kartı istenmez. Deneme boyunca tüm özellikler açıktır." },
  { title: "Ofisinizi ve ekibinizi tanımlayın", text: "Kurulum sihirbazı ofis bilgilerinizi ve ekibinizi adım adım hazırlar; rolleri siz belirlersiniz." },
  { title: "Eşleşmeleri ve uyarıları izleyin", text: "Talep-portföy eşleşmeleri, randevular ve otomatik görev hatırlatmaları panonuza düşer." },
];

function Art({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 240 90" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="239" height="89" rx="12" fill="#fbfaf7" stroke="#e7e3da" />
      {i === 0 ? (
        <>
          <rect x="24" y="18" width="192" height="18" rx="6" fill="#fff" stroke="#e7e3da" />
          <rect x="24" y="44" width="192" height="18" rx="6" fill="#fff" stroke="#e7e3da" />
          <rect x="24" y="68" width="92" height="14" rx="7" fill="#0b4fd6" />
        </>
      ) : null}
      {i === 1 ? (
        <>
          {[0, 1, 2, 3].map((k) => (
            <g key={k}>
              <circle cx={40 + k * 50} cy="36" r="14" fill={k === 0 ? "#0b4fd6" : "#dfe8fb"} />
              <rect x={22 + k * 50} y="58" width="36" height="8" rx="4" fill="#e7e3da" />
            </g>
          ))}
        </>
      ) : null}
      {i === 2 ? (
        <>
          <path d="M20 66 C60 66 70 30 110 38 S170 62 220 22" fill="none" stroke="#0e9f8c" strokeWidth="3" strokeLinecap="round" />
          <circle cx="220" cy="22" r="6" fill="#0e9f8c" />
          <rect x="20" y="16" width="64" height="14" rx="7" fill="#dfe8fb" />
        </>
      ) : null}
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section id="nasil" className="mk-section" aria-labelledby="nasil-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Nasıl çalışır" title={<span id="nasil-baslik">Üç adımda <Em>başlayın.</Em></span>} />
        <div style={{ position: "relative" }}>
          <svg className="mk-path" viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="mk-draw mk-draw-in" pathLength="1" d="M0 12 L1000 12" fill="none" stroke="#9db6e8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        <ol className="mk-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="mk-card mk-step mk-reveal" style={{ position: "relative", zIndex: 1 }}>
              <span className="mk-step-n" aria-hidden="true">{i + 1}</span>
              <h3 className="mk-h3">{s.title}</h3>
              <p>{s.text}</p>
              <Art i={i} />
            </li>
          ))}
        </ol>
        </div>
      </div>
    </section>
  );
}
