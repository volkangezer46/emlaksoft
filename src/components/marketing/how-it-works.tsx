import { LineChart, Settings2, UserPlus } from "lucide-react";
import { trialShort } from "@/lib/marketing-copy";
import { Em, SectionHeading } from "./section-heading";

/* Adımlar kayıt akışı ve kurulum sihirbazıyla uyumludur; süre sözü verilmez. */
function buildSteps(trialDays?: number) {
  return [
  { icon: UserPlus, title: "Hesabınızı açın", text: `${trialShort(trialDays)}, kredi kartı istenmez. Deneme boyunca tüm özellikler açıktır.` },
  { icon: Settings2, title: "Ofisinizi ve ekibinizi tanımlayın", text: "Kurulum sihirbazı ofis bilgilerinizi ve ekibinizi adım adım hazırlar; rolleri siz belirlersiniz. Mevcut müşteri ve portföyleri Excel/CSV ile aktarabilirsiniz." },
  { icon: LineChart, title: "Eşleşmeleri ve uyarıları izleyin", text: "Talep-portföy eşleşmeleri, randevular ve otomatik görev hatırlatmaları panonuza düşer." },
  ];
}

export function HowItWorks({ trialDays }: { trialDays?: number }) {
  const STEPS = buildSteps(trialDays);
  return (
    <section id="nasil" className="mk-section" aria-labelledby="nasil-baslik">
      <div className="mk-wrap">
        <SectionHeading center eyebrow="Nasıl çalışır" title={<span id="nasil-baslik">Üç adımda <Em>başlayın.</Em></span>} />
        <ol className="mk-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="mk-step mk-reveal" style={{ "--i": i } as React.CSSProperties}>
              <span className="mk-step-n" aria-hidden="true">{i + 1}</span>
              <span className="mk-step-ico"><s.icon size={26} aria-hidden="true" /></span>
              <h3 className="mk-h3">{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
