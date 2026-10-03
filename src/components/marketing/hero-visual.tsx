/**
 * Ana sayfa hero ürün illüstrasyonu — saf SVG + CSS, sıfır istemci JS, sıfır
 * harici görsel. Oran sabit (aspect-ratio) olduğu için CLS = 0; LCP öğesi
 * değildir (satır içi SVG), başlık ve açıklama metni LCP'yi belirler.
 *
 * Ekran, gerçek /app ana ekranının renk dilini (lacivert kenar çubuğu + mavi
 * vurgu + nane/amber durum renkleri) ve gerçek menü adlarını (nav-config)
 * kullanır. Tüm sayılar ÖRNEK veridir; köşedeki etiket bunu açıkça söyler.
 */

const NAV = ["Ana ekran", "Müşteriler", "Talepler", "Portföyler", "Randevular", "Anlaşmalar", "Komisyon", "Kayıp-kaçak", "Raporlar"];

const STATS = [
  { label: "Yeni talep", value: "12", tone: "#1463ff" },
  { label: "Aktif portföy", value: "148", tone: "#0e9f8c" },
  { label: "Teyit bekleyen", value: "7", tone: "#b8862f" },
  { label: "Kaçak ilan", value: "3", tone: "#cf3438" },
];

const BARS = [38, 52, 44, 63, 58, 76, 70, 92, 84, 108, 100, 128];
const MONTHS: Record<number, string> = { 0: "Oca", 2: "Mar", 4: "May", 6: "Tem", 8: "Eyl", 10: "Kas" };

const DONUT_R = 44;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT = [
  { label: "Konut", n: 74, color: "#1463ff" },
  { label: "Arsa", n: 30, color: "#10b9a3" },
  { label: "Ticari", n: 25, color: "#e0a53a" },
  { label: "Diğer", n: 19, color: "#7aa9ff" },
];
const DONUT_TOTAL = DONUT.reduce((s, d) => s + d.n, 0);
const DONUT_ARCS = DONUT.map((d, i) => {
  const before = DONUT.slice(0, i).reduce((s, x) => s + x.n, 0);
  return { ...d, len: (d.n / DONUT_TOTAL) * DONUT_C, off: -(before / DONUT_TOTAL) * DONUT_C };
});

const SKYLINE = [
  { x: 40, w: 56, h: 190 },
  { x: 104, w: 44, h: 260 },
  { x: 156, w: 70, h: 215 },
  { x: 234, w: 48, h: 320 },
  { x: 290, w: 62, h: 240 },
  { x: 362, w: 52, h: 360 },
  { x: 422, w: 74, h: 280 },
  { x: 504, w: 46, h: 330 },
  { x: 558, w: 66, h: 230 },
  { x: 632, w: 50, h: 300 },
  { x: 690, w: 70, h: 210 },
];

function Skyline() {
  return (
    <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hv-sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1463ff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#1463ff" stopOpacity="0.02" />
        </linearGradient>
        <pattern id="hv-win" width="12" height="16" patternUnits="userSpaceOnUse">
          <rect x="3" y="4" width="6" height="8" rx="1" fill="#ffffff" opacity="0.7" />
        </pattern>
        <radialGradient id="hv-glow-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#1463ff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#1463ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hv-glow-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#10b9a3" stopOpacity="0.2" />
          <stop offset="1" stopColor="#10b9a3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hv-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f8fc" stopOpacity="0" />
          <stop offset="1" stopColor="#f6f8fc" stopOpacity="1" />
        </linearGradient>
      </defs>
      <circle cx="620" cy="190" r="260" fill="url(#hv-glow-a)" />
      <circle cx="160" cy="470" r="220" fill="url(#hv-glow-b)" />
      {SKYLINE.map((b) => (
        <g key={b.x}>
          <rect x={b.x} y={600 - b.h} width={b.w} height={b.h} rx="3" fill="url(#hv-sk)" />
          <rect x={b.x} y={600 - b.h} width={b.w} height={b.h} rx="3" fill="url(#hv-win)" opacity="0.5" />
        </g>
      ))}
      <rect x="0" y="420" width="800" height="180" fill="url(#hv-haze)" />
    </svg>
  );
}

function DesktopScreen() {
  return (
    <svg viewBox="0 0 760 470" className="block h-auto w-full" aria-hidden="true" focusable="false" fontFamily="var(--font-inter), system-ui, sans-serif">
      <defs>
        <linearGradient id="hv-side" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a2247" />
          <stop offset="1" stopColor="#071a38" />
        </linearGradient>
        <linearGradient id="hv-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3984ff" />
          <stop offset="1" stopColor="#7aa9ff" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="hv-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1463ff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <clipPath id="hv-clip">
          <rect width="760" height="470" rx="20" />
        </clipPath>
      </defs>
      <g clipPath="url(#hv-clip)">
        <rect width="760" height="470" fill="#f6f8fc" />
        {/* kenar çubuğu */}
        <rect width="160" height="470" fill="url(#hv-side)" />
        <rect x="18" y="18" width="28" height="28" rx="8" fill="url(#hv-logo)" />
        <text x="32" y="37.5" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">E</text>
        <text x="54" y="37" fontSize="14" fontWeight="800" fill="#fff">EmlakSoft</text>
        {NAV.map((label, i) => {
          const y = 70 + i * 34;
          return (
            <g key={label}>
              {i === 0 ? <rect x="10" y={y} width="140" height="28" rx="8" fill="#3984ff" fillOpacity="0.3" /> : null}
              <circle cx="26" cy={y + 14} r="4" fill="#fff" fillOpacity={i === 0 ? 0.95 : 0.5} />
              <text x="40" y={y + 18} fontSize="12" fontWeight={i === 0 ? 700 : 500} fill="#fff" fillOpacity={i === 0 ? 1 : 0.78}>{label}</text>
            </g>
          );
        })}
        <rect x="12" y="410" width="136" height="44" rx="10" fill="#fff" fillOpacity="0.07" />
        <text x="24" y="428" fontSize="11" fontWeight="600" fill="#fff" fillOpacity="0.85">Ofis kurulumu</text>
        <rect x="24" y="437" width="112" height="5" rx="2.5" fill="#fff" fillOpacity="0.15" />
        <rect x="24" y="437" width="70" height="5" rx="2.5" fill="#34d3bd" />

        {/* üst çubuk */}
        <rect x="160" width="600" height="58" fill="#fff" />
        <rect x="160" y="58" width="600" height="1" fill="#e6eaf2" />
        <rect x="184" y="14" width="250" height="30" rx="15" fill="#f1f4fa" />
        <circle cx="202" cy="29" r="5" fill="none" stroke="#667085" strokeWidth="1.6" />
        <path d="M206 33l4 4" stroke="#667085" strokeWidth="1.6" strokeLinecap="round" />
        <text x="218" y="33" fontSize="11.5" fill="#667085">Müşteri, portföy, talep ara…</text>
        <rect x="560" y="14" width="66" height="30" rx="10" fill="#1463ff" />
        <text x="593" y="33.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">+ Yeni</text>
        <circle cx="654" cy="29" r="14" fill="#f1f4fa" />
        <circle cx="661" cy="22" r="3.5" fill="#e5484d" />
        <circle cx="710" cy="29" r="15" fill="#0a2c63" />
        <text x="710" y="33" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff">AY</text>

        {/* selamlama */}
        <text x="184" y="92" fontSize="20" fontWeight="800" fill="#071a38">Günaydın, Ayşe</text>
        <text x="184" y="112" fontSize="11.5" fill="#5b6577">Bugün 6 görev, 3 randevu ve 12 yeni talep var.</text>

        {/* istatistik kartları */}
        {STATS.map((s, i) => {
          const x = 184 + i * 141;
          return (
            <g key={s.label}>
              <rect x={x} y="128" width="129" height="76" rx="12" fill="#fff" stroke="#e6eaf2" />
              <circle cx={x + 20} cy="148" r="9" fill={s.tone} fillOpacity="0.14" />
              <circle cx={x + 20} cy="148" r="3.5" fill={s.tone} />
              <text x={x + 36} y="152" fontSize="11" fill="#5b6577">{s.label}</text>
              <text x={x + 14} y="188" fontSize="26" fontWeight="800" fill="#071a38">{s.value}</text>
            </g>
          );
        })}

        {/* aylık performans */}
        <rect x="184" y="220" width="330" height="234" rx="14" fill="#fff" stroke="#e6eaf2" />
        <text x="200" y="245" fontSize="12.5" fontWeight="700" fill="#071a38">Aylık performans</text>
        <rect x="428" y="230" width="72" height="22" rx="11" fill="#f1f4fa" />
        <rect x="430" y="232" width="34" height="18" rx="9" fill="#fff" />
        <text x="447" y="244.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1463ff">Talep</text>
        <text x="482" y="244.5" textAnchor="middle" fontSize="10" fill="#667085">İlan</text>
        {[300, 350, 400].map((y) => (
          <line key={y} x1="200" y1={y} x2="498" y2={y} stroke="#e6eaf2" strokeDasharray="3 5" />
        ))}
        {BARS.map((h, i) => (
          <rect key={i} x={206 + i * 24} y={430 - h} width="14" height={h} rx="3.5" fill={i === BARS.length - 1 ? "#1463ff" : "url(#hv-bar)"} />
        ))}
        <path d={`M${213} ${430 - BARS[0] - 8} ${BARS.map((h, i) => `L${213 + i * 24} ${430 - h - 8}`).join(" ")}`} fill="none" stroke="#10b9a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
        <circle cx={213 + 11 * 24} cy={430 - BARS[11] - 8} r="4" fill="#fff" stroke="#10b9a3" strokeWidth="2" />
        {Object.entries(MONTHS).map(([i, m]) => (
          <text key={m} x={213 + Number(i) * 24} y="446" textAnchor="middle" fontSize="10" fill="#667085">{m}</text>
        ))}
        <rect x="408" y="262" width="92" height="28" rx="8" fill="#071a38" />
        <text x="454" y="274" textAnchor="middle" fontSize="9.5" fill="#fff" fillOpacity="0.7">Aralık</text>
        <text x="454" y="285" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">128 talep</text>

        {/* portföy dağılımı */}
        <rect x="526" y="220" width="210" height="234" rx="14" fill="#fff" stroke="#e6eaf2" />
        <text x="542" y="245" fontSize="12.5" fontWeight="700" fill="#071a38">Portföy dağılımı</text>
        <g transform="rotate(-90 631 322)">
          <circle cx="631" cy="322" r={DONUT_R} fill="none" stroke="#f1f4fa" strokeWidth="18" />
          {DONUT_ARCS.map((d) => (
            <circle key={d.label} cx="631" cy="322" r={DONUT_R} fill="none" stroke={d.color} strokeWidth="18" strokeDasharray={`${d.len - 2} ${DONUT_C - d.len + 2}`} strokeDashoffset={d.off} />
          ))}
        </g>
        <text x="631" y="324" textAnchor="middle" fontSize="22" fontWeight="800" fill="#071a38">{DONUT_TOTAL}</text>
        <text x="631" y="339" textAnchor="middle" fontSize="10" fill="#667085">toplam</text>
        {DONUT.map((d, i) => {
          const x = 546 + (i % 2) * 90;
          const y = 400 + Math.floor(i / 2) * 24;
          return (
            <g key={d.label}>
              <circle cx={x} cy={y - 4} r="4" fill={d.color} />
              <text x={x + 10} y={y} fontSize="11" fill="#5b6577">{d.label}</text>
              <text x={x + 52} y={y} fontSize="11" fontWeight="700" fill="#071a38">{d.n}</text>
            </g>
          );
        })}
      </g>
      <rect x="0.5" y="0.5" width="759" height="469" rx="19.5" fill="none" stroke="#071a38" strokeOpacity="0.1" />
    </svg>
  );
}

function PhoneScreen() {
  const quick = [
    { label: "Müşteri", tone: "#1463ff" },
    { label: "Portföy", tone: "#0e9f8c" },
    { label: "Talep", tone: "#b8862f" },
    { label: "Randevu", tone: "#0891b2" },
  ];
  const rows = [
    { t: "10:00", n: "Ayşe D.", s: "Daire gösterimi", st: "Onaylandı", c: "#0e9f8c" },
    { t: "14:30", n: "Mehmet K.", s: "Arsa gösterimi", st: "Bekliyor", c: "#b8862f" },
    { t: "16:00", n: "Zeynep A.", s: "Sözleşme", st: "Onaylandı", c: "#0e9f8c" },
  ];
  return (
    <svg viewBox="0 0 210 420" className="block h-auto w-full" aria-hidden="true" focusable="false" fontFamily="var(--font-inter), system-ui, sans-serif">
      <defs>
        <linearGradient id="hv-plogo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1463ff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <clipPath id="hv-screen">
          <rect x="12" y="12" width="186" height="396" rx="29" />
        </clipPath>
      </defs>
      <rect x="3" y="3" width="204" height="414" rx="37" fill="#0b1530" />
      <rect x="3.75" y="3.75" width="202.5" height="412.5" rx="36.5" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="1.5" />
      <g clipPath="url(#hv-screen)">
        <rect x="12" y="12" width="186" height="396" fill="#fff" />
        <text x="30" y="34" fontSize="10" fontWeight="700" fill="#071a38">9:41</text>
        <rect x="72" y="20" width="66" height="18" rx="9" fill="#0b1530" />
        <rect x="24" y="50" width="26" height="26" rx="8" fill="url(#hv-plogo)" />
        <text x="37" y="68" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff">E</text>
        <text x="58" y="68" fontSize="13" fontWeight="800" fill="#071a38">EmlakSoft</text>
        <circle cx="176" cy="63" r="12" fill="#0a2c63" />
        <text x="176" y="66.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff">AY</text>
        <rect x="24" y="88" width="162" height="28" rx="14" fill="#f1f4fa" />
        <text x="38" y="106" fontSize="9.5" fill="#667085">Müşteri veya portföy ara…</text>
        {quick.map((q, i) => (
          <g key={q.label}>
            <rect x={26 + i * 40} y="128" width="34" height="34" rx="11" fill={q.tone} fillOpacity="0.13" />
            <circle cx={43 + i * 40} cy="145" r="6" fill="none" stroke={q.tone} strokeWidth="2" />
            <text x={43 + i * 40} y="176" textAnchor="middle" fontSize="8.5" fill="#5b6577">{q.label}</text>
          </g>
        ))}
        <text x="24" y="204" fontSize="11" fontWeight="700" fill="#071a38">Bugünün randevuları</text>
        <text x="186" y="204" textAnchor="end" fontSize="9.5" fontWeight="600" fill="#1463ff">Tümü</text>
        {rows.map((r, i) => {
          const y = 214 + i * 46;
          return (
            <g key={r.n}>
              <rect x="24" y={y} width="162" height="40" rx="10" fill="#f8fafd" stroke="#e6eaf2" />
              <text x="34" y={y + 24} fontSize="10.5" fontWeight="800" fill="#071a38">{r.t}</text>
              <text x="74" y={y + 17} fontSize="10.5" fontWeight="700" fill="#071a38">{r.n}</text>
              <text x="74" y={y + 30} fontSize="9" fill={r.c}>{r.s} · {r.st}</text>
            </g>
          );
        })}
        <path d="M12 360H198V379A29 29 0 0 1 169 408H41A29 29 0 0 1 12 379Z" fill="#fff" />
        <line x1="12" y1="360.5" x2="198" y2="360.5" stroke="#e6eaf2" />
        {["Ana ekran", "Müşteri", "Portföy", "Diğer"].map((l, i) => (
          <g key={l}>
            <circle cx={36 + i * 46} cy="374" r="5" fill={i === 0 ? "#1463ff" : "#667085"} fillOpacity={i === 0 ? 1 : 0.5} />
            <text x={36 + i * 46} y="392" textAnchor="middle" fontSize="8" fontWeight={i === 0 ? 700 : 500} fill={i === 0 ? "#1463ff" : "#667085"}>{l}</text>
          </g>
        ))}
        <rect x="75" y="399" width="60" height="4" rx="2" fill="#0b1530" opacity="0.85" />
      </g>
    </svg>
  );
}

export function HeroVisual() {
  return (
    <div
      role="img"
      aria-label="EmlakSoft ana ekranının örnek görünümü: masaüstünde müşteri, portföy ve talep özetleri; telefonda bugünün randevuları. Gösterilen sayılar örnek veridir."
      className="relative mx-auto w-full max-w-xl aspect-[16/13] lg:max-w-none"
    >
      <Skyline />
      <div className="hero-tilt absolute right-0 top-[9%] w-[93%]">
        <DesktopScreen />
      </div>
      <div className="hero-phone absolute bottom-0 left-0 w-[27%]">
        <PhoneScreen />
      </div>

      {/* süzülen cam kartlar */}
      <div aria-hidden="true" className="hero-chip motion-safe:animate-float absolute -top-[3%] right-[1%] flex max-w-[58%] items-center gap-2.5 rounded-[var(--radius-card)] border border-white/80 bg-white/80 p-2.5 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-danger-500/10 text-danger-600 sm:h-9 sm:w-9">
          <svg viewBox="0 0 24 24" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>
        </span>
        <span className="min-w-0">
          <b className="block text-xs font-bold text-ink-950 sm:text-sm">3 ilan sebepsiz düştü</b>
          <span className="block text-xs text-text-muted">Kayıp-kaçak kalkanı</span>
        </span>
      </div>
      <div aria-hidden="true" className="hero-chip motion-safe:animate-float-slow absolute bottom-[7%] right-[4%] hidden items-center gap-2.5 rounded-[var(--radius-card)] border border-white/80 bg-white/80 p-3 shadow-[var(--shadow-card)] backdrop-blur-xl sm:flex">
        <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-mint-500/12 text-mint-700">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <span>
          <b className="block text-sm font-bold text-ink-950">Sözleşme imzalandı</b>
          <span className="block text-xs text-text-muted">SMS onaylı dijital imza</span>
        </span>
      </div>

      <span className="absolute -bottom-1 right-0 rounded-full border border-line bg-white/90 px-2.5 py-1 text-xs font-semibold text-text-muted shadow-[var(--shadow-xs)] backdrop-blur sm:bottom-1">
        Örnek ekran · örnek veri
      </span>
    </div>
  );
}
