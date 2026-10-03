import Image from "next/image";
import { Check, Clock, FileSignature, Sparkles, Trophy } from "lucide-react";

/* Bento kartlarının illüstrasyonları. Sunucu bileşenleri; tüm içerik ÖRNEKTİR (sayı/isim uydurma yok). */

const STOPS = [
  { x: 50, label: "Talep" },
  { x: 160, label: "Gösterim" },
  { x: 270, label: "Teklif" },
  { x: 380, label: "Kapanış" },
];

export function LeakArt() {
  return (
    <svg className="mk-svg" viewBox="0 0 440 210" role="img" aria-label="Örnek anlaşma zaman çizgisi: talep, gösterim, teklif ve kapanış durakları; teklif aşamasından ayrılan kırmızı kesik yol komisyon kayıp riskini gösterir">
      <path d="M50 70 H380" stroke="#6f8bc0" strokeWidth="3" strokeLinecap="round" />
      <path className="mk-draw" d="M270 70 C305 70 305 150 340 150" fill="none" stroke="#ff7a7f" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 6" />
      <g transform="translate(340 150)">
        <circle r="13" fill="#e5484d" />
        <path d="M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <rect x="222" y="168" width="196" height="30" rx="15" fill="rgba(229,72,77,.2)" stroke="#ff7a7f" strokeOpacity="0.6" />
      <text x="320" y="188" textAnchor="middle" fontSize="13" fontWeight="700" fill="#ffd0d2">Komisyon kayıp riski</text>
      {STOPS.map((s, i) => (
        <g key={s.label}>
          <circle cx={s.x} cy="70" r="15" fill="#0b2152" stroke={i === 3 ? "#7be0c8" : "#9db9ff"} strokeWidth="3" />
          <circle cx={s.x} cy="70" r="5.5" fill={i === 3 ? "#7be0c8" : "#9db9ff"} />
          <text x={s.x} y="34" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

export function ValuationArt() {
  const dots = [[40, 78], [74, 56], [104, 92], [138, 64], [172, 84], [204, 48], [236, 74], [268, 58], [300, 88]];
  return (
    <svg className="mk-svg" viewBox="0 0 340 150" role="img" aria-label="Örnek emsal dağılımı: noktalar emsal portföyleri, vurgulu bant fiyat aralığı sinyalini gösterir">
      <rect x="86" y="24" width="170" height="104" rx="12" fill="rgba(29,92,255,.1)" stroke="#1d5cff" strokeOpacity="0.35" strokeDasharray="4 5" />
      {dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y + 14} r={i === 4 ? 7 : 5} fill={i === 4 ? "#7a3cf0" : "#7fa3f5"} />
      ))}
      <path d="M20 118 L320 118" stroke="#d6dcea" />
      <text x="86" y="144" fontSize="12" fontWeight="700" fill="#55627b">alt sınır</text>
      <text x="171" y="144" textAnchor="middle" fontSize="12" fontWeight="800" fill="#6428d8">orta</text>
      <text x="256" y="144" textAnchor="end" fontSize="12" fontWeight="700" fill="#55627b">üst sınır</text>
    </svg>
  );
}

const JOBS = ["Görev hatırlatma", "Randevu hatırlatma", "Portal teyit", "Günlük özet", "Haftalık özet", "Kira tahakkuku"];
export function AutomationArt() {
  return (
    <ul className="mk-jobs" aria-label="Örnek zamanlanmış görevler">
      {JOBS.map((j) => (
        <li key={j}><Clock size={14} aria-hidden="true" />{j}<Check size={14} aria-hidden="true" /></li>
      ))}
    </ul>
  );
}

export function AssistantArt() {
  return (
    <div className="mk-chat" role="img" aria-label="Örnek AI asistan sohbeti">
      <p className="mk-bubble mk-bubble-user">Bu hafta teklif bekleyen müşterilerim kimler?</p>
      <p className="mk-bubble mk-bubble-ai"><Sparkles size={14} aria-hidden="true" />Teklif aşamasında bekleyen anlaşmalarınızı listeledim. İsterseniz her biri için hatırlatma görevi oluşturayım.</p>
      <p className="mk-chat-note">Telefon, TC, e-posta ve IBAN gibi kişisel veriler yapay zekaya gitmeden maskelenir.</p>
    </div>
  );
}

export function PortalArt() {
  const rows: [string, string, string][] = [["İlan no ekleyin", "veya bağlantı yapıştırın", "ekle"], ["3+1 Daire · Merkez", "Periyodik teyit", "ok"], ["Villa · Sahil", "Teyit bekliyor", "wait"], ["Dükkan · Çarşı", "İlan kapandı · form açıldı", "closed"]];
  return (
    <ul className="mk-prow" aria-label="Örnek portal kontrol listesi">
      {rows.map(([a, b, t]) => (
        <li key={a} data-t={t}>
          <span><b>{a}</b><small>{b}</small></span>
          <i>{t === "ekle" ? "+" : t === "ok" ? "Teyitli" : t === "wait" ? "Bekliyor" : "Kapandı"}</i>
        </li>
      ))}
    </ul>
  );
}

export function SignatureArt() {
  return (
    <div className="mk-sign" role="img" aria-label="Örnek dijital imza akışı: SMS doğrulama kodu ve imza alanı">
      <div className="mk-sms"><FileSignature size={16} aria-hidden="true" /><span>SMS doğrulama kodu gönderildi</span></div>
      <div className="mk-sign-code" aria-hidden="true"><i>4</i><i>8</i><i>2</i><i>1</i><i>7</i><i>•</i></div>
      <svg viewBox="0 0 220 56" aria-hidden="true" focusable="false">
        <path d="M8 40 C 22 8, 36 8, 40 30 S 58 44, 70 20 S 98 8, 104 32 S 130 44, 150 18 S 180 30, 212 24" fill="none" stroke="#1d5cff" strokeWidth="3" strokeLinecap="round" />
        <line x1="8" x2="212" y1="50" y2="50" stroke="#c9d3ea" />
      </svg>
      <p className="mk-chat-note">SMS ile doğrulanan dijital imza; nitelikli e-imza değildir.</p>
    </div>
  );
}

export function ShowcaseArt() {
  return (
    <div className="mk-showcase">
      <Image src="/listing-bosphorus-villa.png" alt="" fill sizes="(min-width: 1024px) 380px, 90vw" className="mk-showcase-img" />
      <div className="mk-showcase-card" aria-hidden="true">
        <b>Ofis vitrini</b>
        <small>Portföyleriniz kendi adresinizde</small>
      </div>
      <span className="mk-tag mk-example mk-showcase-tag">Dekoratif örnek görsel</span>
    </div>
  );
}

export function TeamArt() {
  const rows: [string, number][] = [["Danışman A", 92], ["Danışman B", 74], ["Danışman C", 58], ["Danışman D", 41]];
  return (
    <div className="mk-team" role="img" aria-label="Örnek ekip ligi sıralaması">
      {rows.map(([n, v], i) => (
        <div key={n} className="mk-team-row">
          <span className="mk-team-rank">{i === 0 ? <Trophy size={14} aria-hidden="true" /> : i + 1}</span>
          <b>{n}</b>
          <span className="mk-meter"><i style={{ width: `${v}%` }} /></span>
        </div>
      ))}
    </div>
  );
}
