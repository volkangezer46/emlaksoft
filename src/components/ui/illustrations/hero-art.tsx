import type { ReactNode } from "react";

/**
 * HeroArt — sayfa bandı (DashboardHero `art`) için konuya özel hafif İZOMETRİK SVG sahneleri.
 * Saf SVG, deterministik (sunucu = istemci), dış görsel/telif yok, dekoratif (aria-hidden).
 * Renkler YALNIZ token: vurgu (`--accent`), nane (`--mint-500`), altın (`--gold-*`), yüzey (`--surface-raised`);
 * `color-mix` ile açık/koyu temaya kendiliğinden uyar. Hareket yok (hero degradesi ayrı katmandır).
 * Kullanım: `<DashboardHero art={<HeroArt kind="office" />} />` veya `AdminPageHeader art="office"`.
 */
export const HERO_ART_KINDS = [
  "office",
  "users",
  "invoice",
  "support",
  "shield",
  "rocket",
  "coins",
  "ai",
  "megaphone",
  "pulse",
  "layers",
  "coupon",
] as const;
export type HeroArtKind = (typeof HERO_ART_KINDS)[number];

const A = "var(--accent)";
const L1 = "color-mix(in srgb, var(--accent) 22%, var(--surface-raised))"; // sol yüz
const L2 = "color-mix(in srgb, var(--accent) 10%, var(--surface-raised))"; // sağ yüz
const TOP = "var(--surface-raised)";
const GLASS = "color-mix(in srgb, var(--accent) 55%, var(--surface-raised))";
const GLASS2 = "color-mix(in srgb, var(--accent) 34%, var(--surface-raised))";
const LINE = "color-mix(in srgb, var(--accent) 40%, transparent)";
const MINT = "var(--mint-500)";
const MINT2 = "color-mix(in srgb, var(--mint-500) 55%, var(--surface-raised))";
const GOLD = "var(--gold-400)";
const GOLD2 = "color-mix(in srgb, var(--gold-300) 60%, var(--surface-raised))";

const COS = 0.866;
const SIN = 0.5;
const r = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number) => `${r(x)},${r(y)}`;

/** (x, y) ön alt köşe; a sol derinlik, b sağ derinlik, h yükseklik. */
function box(x: number, y: number, a: number, b: number, h: number, faces: [string, string, string] = [L1, L2, TOP]) {
  const lx = x - a * COS;
  const ly = y - a * SIN;
  const rx = x + b * COS;
  const ry = y - b * SIN;
  const bx = lx + b * COS;
  const by = ly - b * SIN;
  return (
    <g>
      <polygon points={[pt(x, y), pt(lx, ly), pt(lx, ly - h), pt(x, y - h)].join(" ")} fill={faces[0]} />
      <polygon points={[pt(x, y), pt(rx, ry), pt(rx, ry - h), pt(x, y - h)].join(" ")} fill={faces[1]} />
      <polygon points={[pt(x, y - h), pt(lx, ly - h), pt(bx, by - h), pt(rx, ry - h)].join(" ")} fill={faces[2]} />
    </g>
  );
}

/** Sağ yüzde pencere ızgarası (paralelkenar camlar). */
function windowsRight(x: number, y: number, b: number, h: number, cols: number, rows: number, fill = GLASS) {
  const out: ReactNode[] = [];
  const cw = (b - 6) / cols;
  const rh = (h - 10) / rows;
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < rows; k++) {
      const u0 = 3 + c * cw + 1.2;
      const u1 = u0 + cw - 2.4;
      const v0 = 6 + k * rh + 1.5;
      const v1 = v0 + rh - 3;
      const p = (u: number, v: number) => pt(x + u * COS, y - u * SIN - (h - v));
      out.push(<polygon key={`${c}-${k}`} points={[p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)].join(" ")} fill={(c + k) % 3 === 0 ? GLASS2 : fill} />);
    }
  }
  return out;
}

function windowsLeft(x: number, y: number, a: number, h: number, cols: number, rows: number) {
  const out: ReactNode[] = [];
  const cw = (a - 6) / cols;
  const rh = (h - 10) / rows;
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < rows; k++) {
      const u0 = 3 + c * cw + 1.2;
      const u1 = u0 + cw - 2.4;
      const v0 = 6 + k * rh + 1.5;
      const v1 = v0 + rh - 3;
      const p = (u: number, v: number) => pt(x - u * COS, y - u * SIN - (h - v));
      out.push(<polygon key={`${c}-${k}`} points={[p(u0, v0), p(u1, v0), p(u1, v1), p(u0, v1)].join(" ")} fill={GLASS2} opacity="0.85" />);
    }
  }
  return out;
}

function plant(cx: number, cy: number, s = 1) {
  return (
    <g>
      <ellipse cx={cx} cy={cy - 10 * s} rx={9 * s} ry={13 * s} fill={MINT2} />
      <ellipse cx={cx - 6 * s} cy={cy - 6 * s} rx={6 * s} ry={9 * s} fill={MINT} opacity="0.85" />
      <ellipse cx={cx + 6 * s} cy={cy - 4 * s} rx={5 * s} ry={8 * s} fill={MINT} opacity="0.7" />
      <rect x={cx - 3 * s} y={cy - 1 * s} width={6 * s} height={4 * s} rx={1} fill={L1} />
    </g>
  );
}

const ground = (cx = 120, cy = 132, rx = 96) => <ellipse cx={cx} cy={cy} rx={rx} ry={11} fill="currentColor" opacity="0.14" />;
const spark = (x: number, y: number, s = 4, fill = GOLD) => (
  <path d={`M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}Z`} fill={fill} />
);

const SCENES: Record<HeroArtKind, () => ReactNode> = {
  office: () => (
    <>
      {ground()}
      {box(150, 128, 26, 30, 50)}
      {windowsRight(150, 128, 30, 50, 3, 3)}
      {box(118, 126, 40, 46, 96)}
      {windowsRight(118, 126, 46, 96, 4, 6)}
      {windowsLeft(118, 126, 40, 96, 3, 6)}
      <polygon points={[pt(118, 30), pt(118 - 40 * COS, 30 - 40 * SIN), pt(118 - 40 * COS + 46 * COS, 30 - 40 * SIN - 46 * SIN), pt(118 + 46 * COS, 30 - 46 * SIN)].join(" ")} fill={A} opacity="0.18" />
      {plant(70, 130, 1.25)}
      {plant(186, 126, 1)}
      {plant(204, 132, 0.8)}
      {spark(196, 40, 4)}
    </>
  ),
  users: () => (
    <>
      {ground()}
      {box(120, 132, 52, 52, 10)}
      {[[92, 96, 0.9], [148, 96, 0.9], [120, 104, 1.1]].map(([x, y, s]) => (
        <g key={x}>
          <path d={`M${x - 18 * s} ${y + 18 * s}c0-14 8-22 ${18 * s}-22s${18 * s} 8 ${18 * s} 22z`} fill={x === 120 ? A : GLASS2} />
          <circle cx={x} cy={y - 14 * s} r={10 * s} fill={x === 120 ? GLASS : L1} />
        </g>
      ))}
      <rect x="160" y="36" width="52" height="30" rx="8" fill={TOP} stroke={LINE} />
      <circle cx="174" cy="51" r="6" fill={MINT2} />
      <rect x="184" y="45" width="20" height="4" rx="2" fill={L1} />
      <rect x="184" y="53" width="14" height="4" rx="2" fill={L1} />
      {spark(54, 52, 4)}
    </>
  ),
  invoice: () => (
    <>
      {ground()}
      <g transform="rotate(-6 110 80)">
        <path d="M78 24h56l14 14v88l-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5-7-5-7 5z" fill={TOP} stroke={LINE} strokeWidth="1.5" />
        <rect x="88" y="40" width="34" height="6" rx="3" fill={GLASS} />
        {[56, 66, 76, 86].map((y) => (
          <rect key={y} x="88" y={y} width={y === 86 ? 26 : 48} height="4" rx="2" fill={L1} />
        ))}
        <rect x="88" y="100" width="48" height="10" rx="3" fill={A} opacity="0.22" />
      </g>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <ellipse cx="170" cy={124 - i * 7} rx="20" ry="7" fill={i === 3 ? GOLD : GOLD2} stroke={GOLD} strokeWidth="1" />
        </g>
      ))}
      <circle cx="160" cy="44" r="15" fill={MINT} />
      <path d="M153 44l5 5 9-10" fill="none" stroke={TOP} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  support: () => (
    <>
      {ground()}
      <path d="M86 92v-14a34 34 0 0 1 68 0v14" fill="none" stroke={A} strokeWidth="7" strokeLinecap="round" />
      <rect x="76" y="84" width="18" height="30" rx="8" fill={A} />
      <rect x="146" y="84" width="18" height="30" rx="8" fill={A} />
      <path d="M155 114c0 10-10 14-24 14" fill="none" stroke={GLASS} strokeWidth="4" strokeLinecap="round" />
      <rect x="120" y="123" width="14" height="9" rx="4" fill={GLASS} />
      <path d="M168 30h44a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8h-28l-10 9v-9h-6a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z" fill={TOP} stroke={LINE} />
      <circle cx="182" cy="48" r="3" fill={A} />
      <circle cx="192" cy="48" r="3" fill={A} />
      <circle cx="202" cy="48" r="3" fill={A} />
      <path d="M30 46h34a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7h-20l-8 7v-7h-6a7 7 0 0 1-7-7V53a7 7 0 0 1 7-7z" fill={MINT2} />
    </>
  ),
  shield: () => (
    <>
      {ground()}
      <path d="M120 18l44 16v34c0 30-19 52-44 62-25-10-44-32-44-62V34z" fill={L1} />
      <path d="M120 18l44 16v34c0 30-19 52-44 62z" fill={GLASS2} />
      <path d="M120 32l32 12v24c0 22-14 38-32 46-18-8-32-24-32-46V44z" fill={A} opacity="0.85" />
      <path d="M106 74l10 10 20-22" fill="none" stroke={TOP} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="168" y="86" width="30" height="24" rx="5" fill={GOLD} />
      <path d="M174 86v-7a9 9 0 0 1 18 0v7" fill="none" stroke={GOLD} strokeWidth="4" />
      {spark(62, 44, 4, MINT)}
    </>
  ),
  rocket: () => (
    <>
      {ground()}
      <path d="M104 116c-10 6-14 16-14 16s10-2 16-12z" fill={GOLD} />
      <path d="M120 22c22 14 30 40 22 70l-22 22-22-22c-8-30 0-56 22-70z" fill={TOP} stroke={LINE} strokeWidth="1.5" />
      <path d="M120 22c22 14 30 40 22 70l-22 22z" fill={L2} />
      <circle cx="120" cy="62" r="11" fill={GLASS} stroke={A} strokeWidth="3" />
      <path d="M98 92l-14 20 22-6zM142 92l14 20-22-6z" fill={A} />
      <path d="M112 114l8 18 8-18z" fill={GOLD} />
      {spark(56, 40, 5)}
      {spark(184, 58, 4, MINT)}
      {spark(176, 26, 3)}
    </>
  ),
  coins: () => (
    <>
      {ground()}
      {[[92, 6], [130, 9], [166, 4]].map(([x, n]) =>
        Array.from({ length: n }, (_, i) => (
          <ellipse key={`${x}-${i}`} cx={x} cy={124 - i * 8} rx="18" ry="7" fill={i === n - 1 ? GOLD : GOLD2} stroke={GOLD} strokeWidth="1" />
        )),
      )}
      <circle cx="130" cy="30" r="14" fill={GOLD} />
      <text x="130" y="35" textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--gold-ink)">₺</text>
      {spark(70, 50, 4)}
      {spark(196, 54, 4, A)}
    </>
  ),
  ai: () => (
    <>
      {ground()}
      {box(120, 118, 40, 40, 16)}
      <rect x="92" y="50" width="56" height="44" rx="10" fill={A} />
      <rect x="102" y="60" width="36" height="24" rx="5" fill={GLASS} />
      {[100, 112, 124, 136].map((x) => (
        <rect key={x} x={x} y="42" width="4" height="8" rx="2" fill={GLASS2} />
      ))}
      {[100, 112, 124, 136].map((x) => (
        <rect key={`b${x}`} x={x} y="94" width="4" height="8" rx="2" fill={GLASS2} />
      ))}
      {spark(120, 72, 7, TOP)}
      {spark(170, 36, 6)}
      {spark(186, 60, 3, MINT)}
      {spark(66, 44, 4, MINT)}
    </>
  ),
  megaphone: () => (
    <>
      {ground()}
      <path d="M80 72l60-30v68l-60-26z" fill={A} />
      <path d="M140 42v68l8 2V40z" fill={GLASS} />
      <rect x="66" y="68" width="18" height="22" rx="5" fill={GLASS2} />
      <path d="M86 86l6 26h12l-4-22z" fill={L1} />
      <path d="M162 58q10 18 0 36M174 50q16 26 0 52" fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round" />
      {spark(196, 34, 4, MINT)}
    </>
  ),
  pulse: () => (
    <>
      {ground()}
      {box(120, 130, 30, 30, 8)}
      <rect x="62" y="28" width="116" height="78" rx="10" fill={TOP} stroke={LINE} strokeWidth="1.5" />
      <rect x="70" y="36" width="100" height="62" rx="6" fill={L2} />
      <path d="M76 70h20l8-18 12 34 10-24 8 8h30" fill="none" stroke={A} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="164" cy="70" r="5" fill={MINT} />
      <rect x="112" y="106" width="16" height="16" fill={L1} />
    </>
  ),
  layers: () => (
    <>
      {ground()}
      {box(120, 126, 46, 46, 8, [GOLD2, GOLD2, GOLD])}
      {box(120, 104, 42, 42, 8, [L1, L2, GLASS2])}
      {box(120, 82, 38, 38, 8, [GLASS2, L1, A])}
      {spark(184, 40, 5)}
      {spark(58, 54, 4, MINT)}
    </>
  ),
  coupon: () => (
    <>
      {ground()}
      <g transform="rotate(-10 120 78)">
        <path d="M58 48h124v20a10 10 0 0 0 0 20v20H58V88a10 10 0 0 0 0-20z" fill={TOP} stroke={LINE} strokeWidth="1.5" />
        <path d="M150 52v52" stroke={LINE} strokeWidth="2" strokeDasharray="4 4" />
        <circle cx="92" cy="68" r="6" fill="none" stroke={A} strokeWidth="3.5" />
        <circle cx="118" cy="90" r="6" fill="none" stroke={A} strokeWidth="3.5" />
        <path d="M120 64l-30 30" stroke={A} strokeWidth="3.5" strokeLinecap="round" />
        <rect x="158" y="70" width="14" height="16" rx="3" fill={GOLD} />
      </g>
      {spark(196, 36, 4)}
      {spark(46, 40, 3, MINT)}
    </>
  ),
};

export function HeroArt({ kind, className }: { kind: HeroArtKind; className?: string }) {
  return (
    <svg viewBox="0 0 240 150" fill="none" aria-hidden="true" focusable="false" className={className}>
      {SCENES[kind]()}
    </svg>
  );
}
