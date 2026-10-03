import { Lock, Scale, Users } from "lucide-react";
import { Em } from "./section-heading";

/* Garanti dili YOK: "süreç desteği". Maddeler ürün/mimari gerçeklerinden: RLS, rol-izin matrisi, KVKK akışları. */
const ITEMS = [
  { icon: Lock, title: "Ofisinizin verisi ayrı tutulur", text: "Her kayıt ofisinize bağlıdır; veritabanı satır düzeyinde güvenlik (RLS) ile ofisler arası erişimi sınırlar. Ana veritabanı Frankfurt (eu-central-1) bölgesindedir." },
  { icon: Users, title: "Rol ve izin matrisi", text: "Danışman, muhasebe ve yönetici erişimi ayrı ayrı tanımlanır; kullanıcı bazlı istisnalar eklenebilir." },
  { icon: Scale, title: "KVKK süreç desteği", text: "Aydınlatma, rıza, dışa aktarım ve silme akışları ile İYS/EİDS hazırlık adımları ürünün içindedir." },
];

function Shield() {
  return (
    <svg className="mk-shield" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      {[190, 150, 110].map((r, i) => (
        <circle key={r} cx="200" cy="200" r={r} fill="none" stroke="#8fb4ff" strokeOpacity={0.14 + i * 0.08} strokeWidth="1.5" strokeDasharray={i === 1 ? "4 8" : undefined} />
      ))}
      <path d="M200 96 L276 124 V198 C276 244 244 274 200 296 C156 274 124 244 124 198 V124 Z" fill="rgba(20,99,255,.22)" stroke="#8fb4ff" strokeWidth="3" strokeLinejoin="round" />
      <rect x="170" y="186" width="60" height="48" rx="10" fill="#071a38" stroke="#8fe3d3" strokeWidth="3" />
      <path d="M182 186 V170 C182 156 190 148 200 148 C210 148 218 156 218 170 V186" fill="none" stroke="#8fe3d3" strokeWidth="3" strokeLinecap="round" />
      <circle cx="200" cy="210" r="6" fill="#8fe3d3" />
    </svg>
  );
}

export function SecurityBand() {
  return (
    <section id="guvenlik" className="mk-dark mk-section" aria-labelledby="guvenlik-baslik" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <div className="mk-grid-bg-dark" aria-hidden="true" />
      <div className="mk-glow-dark" aria-hidden="true" />
      <div className="mk-wrap">
        <div className="mk-split">
          <div className="mk-reveal">
            <p className="mk-eyebrow">Güvenlik ve KVKK</p>
            <h2 id="guvenlik-baslik" className="mk-h2" style={{ marginTop: "1rem" }}>Verinizi korumak, <Em>süreçle</Em> desteklenir.</h2>
            <ul className="mk-sec-items">
              {ITEMS.map((it) => (
                <li key={it.title}>
                  <span className="mk-sec-ico"><it.icon size={20} aria-hidden="true" /></span>
                  <div>
                    <h3 className="mk-h3">{it.title}</h3>
                    <p>{it.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mk-note">EmlakSoft KVKK süreçlerinizi destekleyen araçlar sunar; hukuki uyumluluk sorumluluğu ofisinizdedir.</p>
          </div>
          <div className="mk-reveal"><Shield /></div>
        </div>
      </div>
    </section>
  );
}
