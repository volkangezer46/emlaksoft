import type { ReactNode } from "react";

/* Ürün ekranı illüstrasyonlarının ortak SVG parçaları. Tüm içerik ÖRNEK veridir (jenerik isimler). */
export const C = {
  ink: "#0a1736",
  navy: "#0b1e4a",
  body: "#475569",
  mute: "#64748b",
  line: "#e3e8f2",
  bg: "#f5f7fc",
  blue: "#1d5cff",
  violet: "#7a3cf0",
  green: "#0e9f7e",
};

export const TONES = {
  blue: { bg: "#e6eeff", fg: "#1546c2" },
  green: { bg: "#dff5ee", fg: "#0a6b57" },
  amber: { bg: "#fff0d2", fg: "#8a5a00" },
  red: { bg: "#ffe3e4", fg: "#b4232a" },
  violet: { bg: "#efe6ff", fg: "#5b2fc4" },
  slate: { bg: "#eaeef6", fg: "#475569" },
} as const;
export type Tone = keyof typeof TONES;

export const NAV9 = ["Bugün", "Müşteriler", "Portföy", "Anlaşmalar", "İletişim", "Finans", "Performans", "Araçlar", "Ofis"] as const;

/** Nav simgeleri: sade çizgi ikonlar (24x24 kutuya göre). */
const ICON_PATHS = [
  "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-3A3.5 3.5 0 0 0 6 17.5V19M11 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "M4 21V8l8-5 8 5v13M9 21v-6h6v6",
  "M4 12l5 5L20 6",
  "M4 5h16v11H8l-4 4z",
  "M12 3v18M16 7c0-1.5-1.8-2.5-4-2.5S8 5.500 8 7s1.800 2.300 4 3 4 1.500 4 3-1.800 2.500-4 2.500-4-1-4-2.500",
  "M5 20V10M12 20V4M19 20v-7",
  "M14 6l4 4L8 20H4v-4zM13 7l4 4",
  "M3 21V7l9-4 9 4v14M9 21v-5h6v5",
];

export function Icon({ i, x, y, size = 16, color = "#fff", opacity = 1 }: { i: number; x: number; y: number; size?: number; color?: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`} opacity={opacity}>
      <path d={ICON_PATHS[i % ICON_PATHS.length]} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function Sidebar({ w, h, active, compact = false }: { w: number; h: number; active: number; compact?: boolean }) {
  const itemH = compact ? 30 : 38;
  return (
    <g>
      <rect width={w} height={h} fill={C.navy} />
      <rect width={w} height={h} fill="url(#mkSide)" />
      <rect x={16} y={16} width={26} height={26} rx={8} fill="url(#mkBrand)" />
      <text x={29} y={34} textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">E</text>
      <text x={52} y={35} fontSize={compact ? 15 : 17} fontWeight="800" fill="#fff">EmlakSoft</text>
      {NAV9.map((n, i) => {
        const y = 66 + i * itemH;
        const on = i === active;
        return (
          <g key={n}>
            {on ? <rect x={8} y={y - 4} width={w - 16} height={itemH - 4} rx={9} fill="url(#mkBrand)" /> : null}
            <Icon i={i} x={20} y={y + (itemH - 4) / 2 - 12} size={compact ? 15 : 17} color="#fff" opacity={on ? 1 : 0.62} />
            <text x={46} y={y + (itemH - 4) / 2 + 4} fontSize={compact ? 12.5 : 14} fontWeight={on ? 700 : 500} fill="#fff" opacity={on ? 1 : 0.72}>{n}</text>
          </g>
        );
      })}
    </g>
  );
}

export function Defs() {
  return (
    <defs>
      <linearGradient id="mkBrand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1d5cff" />
        <stop offset="1" stopColor="#7a3cf0" />
      </linearGradient>
      <linearGradient id="mkSide" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#14307a" stopOpacity="0.55" />
        <stop offset="1" stopColor="#071235" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="mkBar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#4f86ff" />
        <stop offset="1" stopColor="#b9d0ff" />
      </linearGradient>
      <linearGradient id="mkArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1d5cff" stopOpacity="0.28" />
        <stop offset="1" stopColor="#1d5cff" stopOpacity="0" />
      </linearGradient>
      <filter id="mkShadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#0a1736" floodOpacity="0.1" />
      </filter>
    </defs>
  );
}

export function Card({ x, y, w, h, title, right, children }: { x: number; y: number; w: number; h: number; title?: string; right?: string; children?: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx={14} fill="#fff" stroke={C.line} filter="url(#mkShadow)" />
      {title ? <text x={18} y={30} fontSize="15" fontWeight="700" fill={C.ink}>{title}</text> : null}
      {right ? <text x={w - 18} y={30} textAnchor="end" fontSize="12.5" fontWeight="600" fill={C.blue}>{right}</text> : null}
      {children}
    </g>
  );
}

export function Pill({ x, y, text, tone = "blue", size = 12 }: { x: number; y: number; text: string; tone?: Tone; size?: number }) {
  const w = Math.round(text.length * size * 0.56 + 18);
  const t = TONES[tone];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={size + 10} rx={(size + 10) / 2} fill={t.bg} />
      <text x={w / 2} y={size + 1} textAnchor="middle" fontSize={size} fontWeight="700" fill={t.fg}>{text}</text>
    </g>
  );
}

export function Kpi({ x, y, w, label, value, delta, tone = "green", icon = 0 }: { x: number; y: number; w: number; label: string; value: string; delta: string; tone?: Tone; icon?: number }) {
  const t = TONES[tone];
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={92} rx={14} fill="#fff" stroke={C.line} filter="url(#mkShadow)" />
      <rect x={14} y={14} width={28} height={28} rx={9} fill={t.bg} />
      <Icon i={icon} x={20} y={20} size={16} color={t.fg} />
      <text x={52} y={33} fontSize="14" fontWeight="600" fill={C.mute}>{label}</text>
      <text x={16} y={70} fontSize="29" fontWeight="800" fill={C.ink}>{value}</text>
      <text x={w - 14} y={70} textAnchor="end" fontSize="12.5" fontWeight="700" fill={t.fg}>{delta}</text>
    </g>
  );
}

export function Avatar({ x, y, r = 14, text, hue = 0 }: { x: number; y: number; r?: number; text: string; hue?: number }) {
  const fills = ["#dbe7ff", "#e6dcff", "#d8f3ea", "#ffe8c7", "#ffdfe0"];
  const fg = ["#1546c2", "#5b2fc4", "#0a6b57", "#8a5a00", "#b4232a"];
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={fills[hue % 5]} />
      <text x={x} y={y + r * 0.34} textAnchor="middle" fontSize={r * 0.95} fontWeight="800" fill={fg[hue % 5]}>{text}</text>
    </g>
  );
}

/** Uygulama kabuğu: yan menü + üst çubuk + içerik. Tüm ekranlar aynı çerçeveyi kullanır (ürün tutarlılığı). */
export function AppShell({ w, h, sw, active, title, sub, label, cta = "+ Yeni", compact = false, children }: { w: number; h: number; sw: number; active: number; title: string; sub?: string; label: string; cta?: string; compact?: boolean; children: ReactNode }) {
  return (
    <svg className="mk-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} width={w} height={h}>
      <Defs />
      <rect width={w} height={h} fill={C.bg} />
      <Sidebar w={sw} h={h} active={active} compact={compact} />
      <text x={sw + 24} y={44} fontSize={compact ? 19 : 22} fontWeight="800" fill={C.ink}>{title}</text>
      {sub ? <text x={sw + 24} y={64} fontSize="13" fill={C.mute}>{sub}</text> : null}
      <g transform={`translate(${w - 318} 20)`}>
        <rect width="170" height="34" rx="10" fill="#fff" stroke={C.line} />
        <circle cx="18" cy="17" r="5.5" fill="none" stroke={C.mute} strokeWidth="1.8" />
        <path d="M22 21l5 5" stroke={C.mute} strokeWidth="1.8" strokeLinecap="round" />
        <text x="34" y="22" fontSize="12.5" fill={C.mute}>Ara…  Ctrl K</text>
        <rect x="182" width="86" height="34" rx="10" fill="url(#mkBrand)" />
        <text x="225" y="22" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{cta}</text>
        <circle cx="288" cy="17" r="15" fill="#e6dcff" />
        <text x="288" y="22" textAnchor="middle" fontSize="12.5" fontWeight="800" fill="#5b2fc4">EO</text>
      </g>
      {children}
    </svg>
  );
}

export function Bars({ x, y, w, h, vals, hl = -1, labels }: { x: number; y: number; w: number; h: number; vals: number[]; hl?: number; labels?: string[] }) {
  const max = Math.max(...vals);
  const bw = (w / vals.length) * 0.56;
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 1, 2, 3].map((g) => <line key={g} x1={0} x2={w} y1={(h / 3) * g} y2={(h / 3) * g} stroke={C.line} strokeDasharray="3 5" />)}
      {vals.map((v, i) => {
        const bh = (v / max) * (h - 6);
        const bx = (w / vals.length) * i + ((w / vals.length) - bw) / 2;
        return <rect key={i} x={bx} y={h - bh} width={bw} height={bh} rx={5} fill={i === hl ? "url(#mkBrand)" : "url(#mkBar)"} />;
      })}
      {labels ? labels.map((l, i) => <text key={l + i} x={(w / vals.length) * i + w / vals.length / 2} y={h + 18} textAnchor="middle" fontSize="11.5" fill={C.mute}>{l}</text>) : null}
    </g>
  );
}

export function Line({ x, y, w, h, vals, color = C.blue, area = true }: { x: number; y: number; w: number; h: number; vals: number[]; color?: string; area?: boolean }) {
  const max = Math.max(...vals), min = Math.min(...vals);
  const pts = vals.map((v, i) => [(w / (vals.length - 1)) * i, h - ((v - min) / (max - min || 1)) * (h - 8) - 4] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <g transform={`translate(${x} ${y})`}>
      {area ? <path d={`${d} L${w} ${h} L0 ${h} Z`} fill="url(#mkArea)" /> : null}
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5" />
    </g>
  );
}

export function Donut({ cx, cy, r, parts, center, sub }: { cx: number; cy: number; r: number; parts: [number, string][]; center: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p[0], 0);
  const circ = 2 * Math.PI * r;
  return (
    <g>
      {parts.map(([v, color], i) => {
        const len = (v / total) * circ;
        const acc = parts.slice(0, i).reduce((a, q) => a + (q[0] / total) * circ, 0);
        return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={r * 0.34} strokeDasharray={`${Math.max(len - 3, 1)} ${circ}`} strokeDashoffset={-acc} transform={`rotate(-90 ${cx} ${cy})`} />;
      })}
      <text x={cx} y={cy + 2} textAnchor="middle" fontSize={r * 0.5} fontWeight="800" fill={C.ink}>{center}</text>
      <text x={cx} y={cy + r * 0.34 + 4} textAnchor="middle" fontSize={r * 0.2} fill={C.mute}>{sub}</text>
    </g>
  );
}
