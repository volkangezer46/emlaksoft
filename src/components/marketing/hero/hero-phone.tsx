import { C, Icon, TONES, type Tone } from "../art/primitives";

/*
 * Mobil hero sahnesi (yalnız < 768 px görünür; masaüstü/tablet HeroScene'i kullanır). Sunucu bileşeni; istemci JS yok,
 * görsel dosya yok (SVG + CSS). Sabit oran (aspect-ratio) => CLS 0. Tüm isim ve sayılar ÖRNEK veridir.
 * Telefon: CSS ile çizilmiş çerçeve (kenar halkası, yan tuşlar, ada) + SVG "Bugün" ekranı (selamlama, 4 gösterge çipi,
 * bugünün randevuları, alt sekme çubuğu). İki yüzen kart telefonun kenarından yarı taşar.
 * Hareket: hafif süzülme marketing-motion.css'te (.mk-demo kapsamı; ekran dışında/sekme gizliyken/duraklatınca durur,
 * reduced-motion ve JS yokken sabit).
 */

const KPIS: [string, string, Tone, number][] = [
  ["Aktif portföy", "38", "blue", 2],
  ["Yeni talep", "12", "violet", 1],
  ["Randevu", "3", "amber", 3],
  ["Komisyon", "₺184 bin", "gold", 5],
];

const APPTS: [string, string, string, string, Tone][] = [
  ["10:00", "Yer gösterme", "Kadıköy · 3+1 daire", "Onaylı", "green"],
  ["14:30", "Müşteri görüşmesi", "Ofiste · Ayşe K.", "Onaylı", "green"],
  ["16:00", "Sözleşme imzası", "Ataşehir · kiralık", "Bekliyor", "amber"],
];

const TABS = ["Bugün", "Müşteriler", "Portföy", "Takvim", "Menü"] as const;

function TabIcon({ i, x, on }: { i: number; x: number; on: boolean }) {
  const color = on ? C.blue : "#8a96ad";
  if (i === 3) {
    // takvim
    return (
      <g transform={`translate(${x - 9} 532)`} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
        <rect x="1" y="3" width="16" height="14" rx="3" />
        <path d="M1 8h16M5.5 1v4M12.5 1v4" />
      </g>
    );
  }
  if (i === 4) {
    return (
      <g transform={`translate(${x - 9} 534)`} stroke={color} strokeWidth="1.8" strokeLinecap="round">
        <path d="M2 2h14M2 7.5h14M2 13h14" />
      </g>
    );
  }
  return <Icon i={[0, 1, 2][i]!} x={x - 9} y={532} size={18} color={color} />;
}

/** Telefon ekranı: uygulamanın mobil "Bugün" görünümü (örnek veri). */
function PhoneToday() {
  return (
    <svg
      className="mk-svg"
      viewBox="0 0 280 580"
      role="img"
      aria-label="Örnek ekran: EmlakSoft mobil Bugün görünümü; selamlama, dört gösterge, bugünün üç randevusu ve alt sekme çubuğu"
      width="280"
      height="580"
    >
      <defs>
        <linearGradient id="mkMpBrand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d5cff" />
          <stop offset="1" stopColor="#0d2b5e" />
        </linearGradient>
        <linearGradient id="mkMpHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9f0ff" />
          <stop offset="1" stopColor="#f5f7fc" />
        </linearGradient>
      </defs>
      <rect width="280" height="580" fill={C.bg} />
      <rect width="280" height="170" fill="url(#mkMpHead)" />

      {/* durum çubuğu */}
      <text x="26" y="27" fontSize="12" fontWeight="700" fill={C.ink}>9:41</text>
      <g transform="translate(206 17)" fill={C.ink}>
        <rect x="0" y="7" width="3" height="4" rx="1" />
        <rect x="4.5" y="5" width="3" height="6" rx="1" />
        <rect x="9" y="3" width="3" height="8" rx="1" />
        <rect x="13.5" y="1" width="3" height="10" rx="1" />
        <path d="M24 5.2a8 8 0 0 1 10.4 0M26.2 7.6a4.6 4.6 0 0 1 6 0" fill="none" stroke={C.ink} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="29.2" cy="10" r="1.3" />
        <rect x="40" y="1.5" width="20" height="10" rx="3" fill="none" stroke={C.ink} strokeOpacity="0.45" />
        <rect x="42" y="3.5" width="14" height="6" rx="1.5" />
      </g>

      {/* uygulama başlığı */}
      <rect x="18" y="46" width="28" height="28" rx="9" fill="url(#mkMpBrand)" />
      <text x="32" y="65.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">E</text>
      <text x="54" y="66" fontSize="17" fontWeight="800" fill={C.ink}>Bugün</text>
      <g transform="translate(206 49)" fill="none" stroke={C.body} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 15V9a6 6 0 0 1 12 0v6l1.5 2h-15z" />
        <path d="M9 20h4" />
      </g>
      <circle cx="225" cy="52" r="4" fill="#e5484d" stroke="#fff" strokeWidth="1.5" />
      <circle cx="248" cy="60" r="14" fill="#dbe7ff" />
      <text x="248" y="64.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#1546c2">AY</text>

      {/* selamlama */}
      <text x="18" y="106" fontSize="19" fontWeight="800" fill={C.ink}>Günaydın, Ayşe</text>
      <text x="18" y="125" fontSize="11.5" fill={C.mute}>2 iş dikkat bekliyor · ilki kapanış formu</text>

      {/* 4 gösterge çipi */}
      {KPIS.map(([label, value, tone, icon], i) => {
        const t = TONES[tone];
        const x = 18 + (i % 2) * 126;
        const y = 140 + Math.floor(i / 2) * 64;
        return (
          <g key={label} transform={`translate(${x} ${y})`}>
            <rect width="118" height="56" rx="13" fill="#fff" stroke={C.line} />
            <rect x="10" y="10" width="20" height="20" rx="6" fill={t.bg} />
            <Icon i={icon} x={13} y={13} size={14} color={t.fg} />
            <text x="36" y="24" fontSize="10.5" fontWeight="600" fill={C.mute}>{label}</text>
            <text x="11" y="47" fontSize="16.5" fontWeight="800" fill={tone === "gold" ? C.goldText : C.ink}>{value}</text>
          </g>
        );
      })}

      {/* bugünün randevuları */}
      <text x="18" y="292" fontSize="14" fontWeight="800" fill={C.ink}>Bugünün randevuları</text>
      <text x="262" y="292" textAnchor="end" fontSize="11.5" fontWeight="700" fill={C.blue}>Tümü</text>
      {APPTS.map(([time, title, sub, status, tone], i) => {
        const t = TONES[tone];
        const w = Math.round(status.length * 5.6 + 16);
        return (
          <g key={time} transform={`translate(18 ${304 + i * 66})`}>
            <rect width="244" height="58" rx="14" fill="#fff" stroke={C.line} />
            <rect x="10" y="10" width="46" height="38" rx="10" fill={i === 0 ? "#1d5cff" : "#eef3ff"} />
            <text x="33" y="34" textAnchor="middle" fontSize="12" fontWeight="800" fill={i === 0 ? "#fff" : "#1546c2"}>{time}</text>
            <text x="66" y="26" fontSize="12.5" fontWeight="700" fill={C.ink}>{title}</text>
            <text x="66" y="43" fontSize="10.5" fill={C.mute}>{sub}</text>
            <rect x={234 - w} y="8" width={w} height="17" rx="8.5" fill={t.bg} />
            <text x={234 - w / 2} y="20" textAnchor="middle" fontSize="9.5" fontWeight="700" fill={t.fg}>{status}</text>
          </g>
        );
      })}

      {/* alt sekme çubuğu */}
      <rect y="514" width="280" height="66" fill="#fff" />
      <line x1="0" x2="280" y1="514.5" y2="514.5" stroke={C.line} />
      {TABS.map((label, i) => {
        const x = 28 + i * 56;
        const on = i === 0;
        return (
          <g key={label}>
            {on ? <rect x={x - 20} y="527" width="40" height="28" rx="14" fill="#e6eeff" /> : null}
            <TabIcon i={i} x={x} on={on} />
            <text x={x} y="566" textAnchor="middle" fontSize="9.5" fontWeight={on ? 800 : 600} fill={on ? C.blue : "#7a869c"}>{label}</text>
          </g>
        );
      })}
      <rect x="105" y="572" width="70" height="4" rx="2" fill={C.ink} opacity="0.85" />
    </svg>
  );
}

const ATTN: [string, string, Tone][] = [
  ["Kapanış formu", "Acil", "red"],
  ["Teklif yanıtı", "Yüksek", "amber"],
  ["Yayın teyidi", "Orta", "gold"],
];

/** Altın alan grafiği (aylık komisyon, örnek seri). */
function MoneySpark() {
  const vals = [62, 70, 66, 78, 84, 80, 96, 104, 112, 126, 142, 184];
  const w = 150;
  const h = 40;
  const max = 184;
  const min = 50;
  const pts = vals.map((v, i) => [(w / (vals.length - 1)) * i, h - ((v - min) / (max - min)) * (h - 6) - 3] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg className="mk-mcard-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="mkMpGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e5b04d" stopOpacity="0.42" />
          <stop offset="1" stopColor="#e5b04d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#mkMpGold)" />
      <path d={d} fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0] - 3} cy={last[1] + 1} r="3" fill="#fff" stroke={C.gold} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HeroPhoneScene() {
  return (
    <div className="mk-mscene mk-demo" role="group" aria-label="Ürün görünümü: örnek mobil ekran, dikkat listesi ve aylık komisyon kartı">
      <div className="mk-mphone-wrap">
        <div className="mk-mphone">
          <i className="mk-mphone-island" aria-hidden="true" />
          <PhoneToday />
        </div>
      </div>

      <div className="mk-mcard mk-mcard-attn" aria-hidden="true">
        <p className="mk-mcard-head"><b>Dikkat gerektirenler</b><span>3 iş</span></p>
        <ul>
          {ATTN.map(([title, level, tone]) => (
            <li key={title}>
              <i style={{ background: TONES[tone].fg }} />
              <span>{title}</span>
              <em style={{ background: TONES[tone].bg, color: TONES[tone].fg }}>{level}</em>
            </li>
          ))}
        </ul>
      </div>

      <div className="mk-mcard mk-mcard-money" aria-hidden="true">
        <p className="mk-mcard-label">Aylık komisyon</p>
        <p className="mk-mcard-value"><b>₺184 bin</b><em>↗ %30</em></p>
        <MoneySpark />
      </div>

    </div>
  );
}
