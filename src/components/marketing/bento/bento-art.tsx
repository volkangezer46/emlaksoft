/* Bento kartı illüstrasyonları: saf SVG, dekoratif (aria-hidden). Sayılar ve isimler örnek veridir. */
const common = { "aria-hidden": true, focusable: false } as const;

export function MatchArt() {
  const left = ["Talep · 3+1", "Talep · Arsa", "Talep · Kiralık", "Talep · Dükkan"];
  const right = ["Portföy · Daire", "Portföy · Arsa", "Portföy · Daire", "Portföy · Ofis"];
  const links: [number, number, boolean][] = [[0, 0, true], [0, 2, false], [1, 1, true], [2, 2, false], [3, 3, true], [2, 0, false]];
  return (
    <svg viewBox="0 0 560 300" {...common}>
      {links.map(([a, b, on], i) => (
        <path key={i} d={`M170 ${46 + a * 66} C280 ${46 + a * 66} 280 ${46 + b * 66} 390 ${46 + b * 66}`} fill="none" stroke={on ? "#0e9f8c" : "#c4cfe3"} strokeWidth={on ? 3 : 2} strokeDasharray={on ? undefined : "4 6"} strokeLinecap="round" />
      ))}
      {left.map((t, i) => (
        <g key={t}>
          <rect x="20" y={26 + i * 66} width="150" height="40" rx="10" fill="#fff" stroke="#e7e3da" />
          <circle cx="40" cy={46 + i * 66} r="6" fill="#1463ff" />
          <text x="56" y={51 + i * 66} fontSize="14" fontWeight="600" fill="#071a38">{t}</text>
        </g>
      ))}
      {right.map((t, i) => (
        <g key={i}>
          <rect x="390" y={26 + i * 66} width="150" height="40" rx="10" fill="#fff" stroke="#e7e3da" />
          <circle cx="410" cy={46 + i * 66} r="6" fill="#0e9f8c" />
          <text x="426" y={51 + i * 66} fontSize="14" fontWeight="600" fill="#071a38">{t}</text>
        </g>
      ))}
      <rect x="235" y="272" width="90" height="22" rx="11" fill="#e3f6f2" />
      <text x="280" y="288" textAnchor="middle" fontSize="12" fontWeight="600" fill="#0b8172">Eşleşme</text>
    </svg>
  );
}

export function CalendarArt() {
  const on = new Set([2, 5, 9, 12, 16, 19]);
  return (
    <svg viewBox="0 0 400 150" {...common}>
      {Array.from({ length: 28 }, (_, i) => {
        const x = 8 + (i % 7) * 40;
        const y = 8 + Math.floor(i / 7) * 32;
        return <rect key={i} x={x} y={y} width="34" height="26" rx="7" fill={i === 12 ? "#1463ff" : on.has(i) ? "#dbe7ff" : "#fff"} stroke="#e7e3da" />;
      })}
      <rect x="296" y="42" width="96" height="36" rx="12" fill="#fff" stroke="#e7e3da" style={{ filter: "drop-shadow(0 6px 10px rgba(10,34,71,.12))" }} />
      <text x="344" y="65" textAnchor="middle" fontSize="14" fontWeight="700" fill="#071a38">14:30</text>
    </svg>
  );
}

export function CommissionArt() {
  const cols = [[34, 20, 12], [44, 26, 14], [38, 30, 18], [56, 28, 16], [66, 34, 20]];
  return (
    <svg viewBox="0 0 400 150" {...common}>
      <line x1="10" x2="390" y1="132" y2="132" stroke="#e7e3da" />
      {cols.map(([a, b, c], i) => {
        const x = 24 + i * 74;
        return (
          <g key={i}>
            <rect x={x} y={132 - a} width="44" height={a} rx="4" fill="#1463ff" />
            <rect x={x} y={132 - a - b - 2} width="44" height={b} rx="4" fill="#0e9f8c" />
            <rect x={x} y={132 - a - b - c - 4} width="44" height={c} rx="4" fill="#e0a53a" />
          </g>
        );
      })}
    </svg>
  );
}

export function ValuationArt() {
  const dots = [[40, 96], [62, 80], [88, 90], [110, 62], [136, 74], [160, 54], [188, 66], [214, 46], [240, 58], [270, 40], [300, 52], [330, 36]];
  return (
    <svg viewBox="0 0 400 150" {...common}>
      <rect x="10" y="40" width="380" height="50" rx="10" fill="#dbe7ff" opacity="0.55" />
      <path d="M10 104 L390 28" stroke="#1463ff" strokeWidth="2" strokeDasharray="5 6" />
      {dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" fill={i === 7 ? "#0e9f8c" : "#1463ff"} opacity={i === 7 ? 1 : 0.8} />)}
      <text x="22" y="140" fontSize="12" fill="#5b6577">Emsal dağılımı ve aralık</text>
    </svg>
  );
}

export function SignatureArt() {
  const code = ["4", "8", "2", "9", "1", "7"];
  return (
    <svg viewBox="0 0 400 150" {...common}>
      {code.map((d, i) => (
        <g key={i}>
          <rect x={12 + i * 63} y="34" width="52" height="64" rx="12" fill="#fff" stroke={i === 5 ? "#1463ff" : "#e7e3da"} strokeWidth={i === 5 ? 2 : 1} />
          <text x={38 + i * 63} y="76" textAnchor="middle" fontSize="28" fontWeight="700" fill="#071a38" fontFamily="var(--font-geist-mono), monospace">{d}</text>
        </g>
      ))}
      <text x="12" y="132" fontSize="12" fill="#5b6577">SMS ile gelen 6 haneli doğrulama kodu</text>
    </svg>
  );
}

export function AutomationArt() {
  const pts = [10, 24, 38, 56, 66, 88, 104, 130, 150, 168, 196, 214, 240, 262, 290, 318, 340, 366];
  return (
    <svg viewBox="0 0 400 150" {...common}>
      <line x1="10" x2="390" y1="70" y2="70" stroke="#d6dcea" strokeWidth="2" />
      {pts.map((x, i) => <circle key={i} cx={x + 8} cy="70" r={i % 5 === 0 ? 7 : 4.5} fill={i % 5 === 0 ? "#1463ff" : "#9db6e8"} />)}
      {["00:00", "06:00", "12:00", "18:00"].map((t, i) => <text key={t} x={10 + i * 120} y="112" fontSize="12" fill="#5b6577">{t}</text>)}
      <text x="10" y="40" fontSize="14" fontWeight="700" fill="#071a38" className="mk-m">Gün boyu arka planda</text>
    </svg>
  );
}
