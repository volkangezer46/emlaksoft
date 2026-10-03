/**
 * CityNight — elle çizilmiş, saf SVG gece şehri silueti (dış görsel/telif yok).
 * Deterministik: pencere ışıkları sabit bir tohumla üretilir (sunucu/istemci aynı).
 * Yıldız ve bazı pencereler `pm-twinkle` ile hafifçe parlar; prefers-reduced-motion'da
 * animasyon tamamen durur (premium.css). Dekoratif: aria-hidden.
 */

const W = 640;
const H = 260;
const BASE = 250;

// [x, genişlik, yükseklik, çatı]  çatı: 0 düz, 1 anten, 2 basamaklı
const BUILDINGS: readonly [number, number, number, number][] = [
  [20, 34, 70, 0],
  [58, 26, 112, 1],
  [88, 40, 88, 2],
  [132, 30, 140, 1],
  [166, 44, 96, 0],
  [214, 28, 158, 1],
  [246, 38, 118, 2],
  [288, 46, 84, 0],
  [338, 30, 128, 0],
  [372, 36, 176, 1],
  [412, 42, 104, 2],
  [458, 30, 146, 0],
  [492, 40, 92, 0],
  [536, 32, 122, 1],
  [572, 44, 74, 0],
];

/** Küçük tamsayı karması: aynı (a,b) her zaman aynı çıktı. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

const STARS = Array.from({ length: 18 }, (_, i) => ({
  x: 12 + hash(i, 1) * 6.2,
  y: 8 + hash(i, 2) * 0.9,
  r: 0.7 + (hash(i, 3) % 3) * 0.35,
  d: hash(i, 4) % 3,
}));

function windows() {
  const out: { x: number; y: number; d: number }[] = [];
  for (const [bx, bw, bh] of BUILDINGS) {
    const cols = Math.floor((bw - 8) / 8);
    const rows = Math.floor((bh - 14) / 12);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash(bx + c * 7, r * 13 + bh) < 34) {
          out.push({ x: bx + 6 + c * 8, y: BASE - bh + 10 + r * 12, d: hash(c + r, bx) % 9 === 0 ? 1 + (hash(r, c) % 2) : 0 });
        }
      }
    }
  }
  return out;
}
const LIT = windows();

export function CityNight({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMaxYMax slice"
      className={className}
    >
      <defs>
        <radialGradient id="pm-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f8e0a8" stopOpacity="0.9" />
          <stop offset="35%" stopColor="#f0c36a" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f0c36a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pm-bld" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12305f" />
          <stop offset="100%" stopColor="#081b3b" />
        </linearGradient>
        <linearGradient id="pm-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a2247" stopOpacity="0" />
          <stop offset="100%" stopColor="#050f24" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* Ay + hale */}
      <circle cx="540" cy="58" r="64" fill="url(#pm-moon)" />
      <circle cx="540" cy="58" r="13" fill="#f8e0a8" opacity="0.92" />
      <circle cx="545" cy="54" r="11" fill="#0a2247" opacity="0.55" />

      {/* İnce altın yay (ufuk) */}
      <path d="M-20 232 C 160 120, 420 70, 700 150" fill="none" stroke="#d4a24c" strokeWidth="1" opacity="0.4" />

      {/* Yıldızlar */}
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className="pm-twinkle" data-d={s.d} opacity="0.7" />
      ))}

      {/* Binalar */}
      {BUILDINGS.map(([x, w, h, roof], i) => (
        <g key={i}>
          <rect x={x} y={BASE - h} width={w} height={h} fill="url(#pm-bld)" />
          <rect x={x} y={BASE - h} width={w} height="1.2" fill="#d4a24c" opacity="0.25" />
          {roof === 1 ? (
            <path d={`M${x + w / 2} ${BASE - h} v-16`} stroke="#d4a24c" strokeWidth="1.2" opacity="0.7" />
          ) : null}
          {roof === 2 ? <rect x={x + w * 0.25} y={BASE - h - 8} width={w * 0.5} height="8" fill="url(#pm-bld)" /> : null}
        </g>
      ))}

      {/* Yanan pencereler */}
      {LIT.map((w, i) => (
        <rect
          key={i}
          x={w.x}
          y={w.y}
          width="4"
          height="6"
          rx="0.6"
          fill="#f0c36a"
          opacity="0.82"
          className={w.d ? "pm-twinkle" : undefined}
          data-d={w.d || undefined}
        />
      ))}

      <rect x="0" y={BASE - 40} width={W} height={H - BASE + 40} fill="url(#pm-ground)" />
    </svg>
  );
}
