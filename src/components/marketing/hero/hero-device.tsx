/**
 * Hero ürün ekranı: saf SVG (sunucu bileşeni, istemci JS yok). Kenar çubuğu gerçek /app menüsünün 9 iş
 * başlığını (nav-config) kullanır. Tüm sayılar ÖRNEK veridir; çerçevedeki rozet bunu açıkça söyler.
 */
const NAV = ["Bugün", "Müşteriler", "Portföy", "Anlaşmalar", "İletişim", "Finans", "Performans", "Araçlar", "Ofis"];
const STATS = [
  { label: "Yeni talep", value: "12", tone: "#1463ff" },
  { label: "Bugünkü randevu", value: "4", tone: "#0e9f8c" },
  { label: "Teyit bekleyen", value: "7", tone: "#b8862f" },
];
const BARS = [38, 52, 44, 63, 58, 76, 70, 92, 84, 108, 100, 128];
const ROWS = [
  { a: "Talep · 3+1 daire", b: "4 portföy eşleşti", c: "#0e9f8c" },
  { a: "Talep · Satılık arsa", b: "2 portföy eşleşti", c: "#0e9f8c" },
  { a: "Talep · 2+1 kiralık", b: "Yeni eşleşme yok", c: "#9aa3b2" },
  { a: "Talep · Dükkan", b: "1 portföy eşleşti", c: "#0e9f8c" },
];

export function HeroDevice() {
  return (
    <svg className="mk-device-screen mk-svg" viewBox="0 0 1200 720" role="img" aria-label="EmlakSoft Bugün panosu örnek ekranı: yan menü, üç özet kartı, çubuk grafik ve talep-portföy eşleşme listesi" width="1200" height="720">
      <rect width="1200" height="720" fill="#f6f8fc" />
      <rect width="208" height="720" fill="#071a38" />
      <text x="28" y="48" className="mk-m" fontSize="20" fontWeight="700" fill="#fff">EmlakSoft</text>
      {NAV.map((n, i) => (
        <g key={n}>
          {i === 0 ? <rect x="14" y={76 + i * 46} width="180" height="38" rx="10" fill="#1463ff" /> : null}
          <rect x="30" y={89 + i * 46} width="12" height="12" rx="3" fill={i === 0 ? "#fff" : "#6d86b0"} />
          <text x="54" y={100 + i * 46} fontSize="15" fontWeight={i === 0 ? 600 : 500} fill={i === 0 ? "#fff" : "#a9bad6"}>{n}</text>
        </g>
      ))}

      <text x="244" y="62" className="mk-m" fontSize="28" fontWeight="700" fill="#071a38">Bugün</text>
      <text x="244" y="86" fontSize="14" fill="#5b6577">Görevler, randevular ve yeni talepler</text>
      <rect x="930" y="40" width="236" height="40" rx="10" fill="#fff" stroke="#e6eaf2" />
      <text x="950" y="65" fontSize="14" fill="#667085">Ara…</text>
      <rect x="1090" y="49" width="64" height="22" rx="6" fill="#f1f3f8" stroke="#e6eaf2" />
      <text x="1102" y="65" fontSize="12" fontWeight="600" fill="#5b6577">Ctrl K</text>

      {STATS.map((s, i) => (
        <g key={s.label} transform={`translate(${244 + i * 316} 112)`}>
          <rect width="296" height="108" rx="16" fill="#fff" stroke="#e6eaf2" />
          <rect x="20" y="22" width="34" height="34" rx="10" fill={s.tone} opacity="0.12" />
          <circle cx="37" cy="39" r="6" fill={s.tone} />
          <text x="70" y="44" fontSize="14" fontWeight="500" fill="#5b6577">{s.label}</text>
          <text x="20" y="92" className="mk-m" fontSize="36" fontWeight="700" fill="#071a38">{s.value}</text>
          <path d="M170 90 L195 78 L220 84 L246 62 L272 54" fill="none" stroke={s.tone} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}

      <g transform="translate(244 244)">
        <rect width="560" height="440" rx="16" fill="#fff" stroke="#e6eaf2" />
        <text x="24" y="40" fontSize="16" fontWeight="700" fill="#071a38">Haftalık talep akışı</text>
        <text x="24" y="62" fontSize="13" fill="#667085">Son 12 hafta</text>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="24" x2="536" y1={150 + i * 66} y2={150 + i * 66} stroke="#0a2247" strokeOpacity="0.07" strokeDasharray="3 6" />
        ))}
        {BARS.map((h, i) => (
          <rect key={i} x={30 + i * 42} y={350 - h * 1.6} width="26" height={h * 1.6} rx="6" fill={i === 11 ? "#1463ff" : "#c9dbff"} />
        ))}
        {["Oca", "Mar", "May", "Tem", "Eyl", "Kas"].map((m, i) => (
          <text key={m} x={30 + i * 84} y="384" fontSize="12" fill="#667085">{m}</text>
        ))}
      </g>

      <g transform="translate(828 244)">
        <rect width="338" height="440" rx="16" fill="#fff" stroke="#e6eaf2" />
        <text x="24" y="40" fontSize="16" fontWeight="700" fill="#071a38">Talep ve portföy eşleşmesi</text>
        {ROWS.map((r, i) => (
          <g key={r.a} transform={`translate(20 ${68 + i * 80})`}>
            <rect width="298" height="64" rx="12" fill="#f6f8fc" />
            <circle cx="28" cy="32" r="14" fill={r.c} opacity="0.16" />
            <circle cx="28" cy="32" r="5" fill={r.c} />
            <text x="54" y="28" fontSize="14" fontWeight="600" fill="#071a38">{r.a}</text>
            <text x="54" y="48" fontSize="13" fill="#5b6577">{r.b}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
