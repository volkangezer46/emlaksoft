/**
 * CityNight — elle çizilmiş, saf SVG gece şehri (dış görsel/telif yok). Çok katmanlı
 * derinlik: uzak siluet (sisli) → orta sıra → ön sıra (pencere ışıklı) + ay + yıldızlar
 * + ufuk parıltısı + alt sis. Deterministik: tüm rastgelelik sabit tohumla üretilir
 * (sunucu/istemci aynı). Yıldız ve bazı pencereler `pm-twinkle` ile parlar;
 * prefers-reduced-motion'da animasyon durur (premium.css). Dekoratif: aria-hidden.
 */

const W = 800;
const H = 300;
const BASE = 290;

/** Küçük tamsayı karması: aynı (a,b) her zaman aynı çıktı. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

type Bld = { x: number; w: number; h: number; roof: 0 | 1 | 2 };

/** Bir katman için bitişik bina dizisi (tohumlu). */
function layer(seed: number, minW: number, maxW: number, minH: number, maxH: number, gap: number): Bld[] {
  const out: Bld[] = [];
  let x = -10;
  let i = 0;
  while (x < W + 20) {
    const w = minW + Math.round(((hash(i, seed) % 100) / 100) * (maxW - minW));
    const h = minH + Math.round(((hash(i, seed + 7) % 100) / 100) * (maxH - minH));
    const r = hash(i, seed + 13) % 5;
    out.push({ x, w, h, roof: r === 0 ? 1 : r === 1 ? 2 : 0 });
    x += w + gap + (hash(i, seed + 3) % 4);
    i++;
  }
  return out;
}

const FAR = layer(11, 26, 52, 60, 150, 0);
const MID = layer(23, 30, 54, 90, 190, 2);
const NEAR = layer(37, 34, 64, 70, 150, 5);

function windowsOf(blds: Bld[], seed: number, density: number) {
  const out: { x: number; y: number; d: number; warm: boolean }[] = [];
  for (const b of blds) {
    const cols = Math.floor((b.w - 8) / 9);
    const rows = Math.floor((b.h - 16) / 13);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash(b.x + c * 7, r * 13 + b.h + seed) < density) {
          out.push({
            x: b.x + 6 + c * 9,
            y: BASE - b.h + 12 + r * 13,
            d: hash(c + r, b.x + seed) % 9 === 0 ? 1 + (hash(r, c + seed) % 2) : 0,
            warm: hash(c, r + b.x) % 5 !== 0,
          });
        }
      }
    }
  }
  return out;
}

const LIT_MID = windowsOf(MID, 5, 26);
const LIT_NEAR = windowsOf(NEAR, 9, 38);

const STARS = Array.from({ length: 46 }, (_, i) => ({
  x: 8 + hash(i, 1) * 7.8 + (hash(i, 5) % 10) * 0.3,
  y: 6 + hash(i, 2) * 1.5,
  r: 0.6 + (hash(i, 3) % 4) * 0.28,
  d: hash(i, 4) % 3,
  a: 0.4 + (hash(i, 6) % 5) * 0.12,
}));

function Roofs({ blds, fill }: { blds: Bld[]; fill: string }) {
  return (
    <>
      {blds.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={BASE - b.h} width={b.w} height={b.h + 12} fill={fill} />
          {b.roof === 1 ? <path d={`M${b.x + b.w / 2} ${BASE - b.h} v-18`} stroke="#d4a24c" strokeWidth="1.1" opacity="0.6" /> : null}
          {b.roof === 2 ? <rect x={b.x + b.w * 0.22} y={BASE - b.h - 9} width={b.w * 0.56} height="9" fill={fill} /> : null}
        </g>
      ))}
    </>
  );
}

export function CityNight({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax slice" className={className}>
      <defs>
        <radialGradient id="pm-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fbeac0" stopOpacity="0.95" />
          <stop offset="30%" stopColor="#f0c36a" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#f0c36a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pm-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4a24c" stopOpacity="0" />
          <stop offset="100%" stopColor="#d4a24c" stopOpacity="0.32" />
        </linearGradient>
        <linearGradient id="pm-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#274b86" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#173764" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="pm-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#15366a" />
          <stop offset="100%" stopColor="#0c2550" />
        </linearGradient>
        <linearGradient id="pm-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c2247" />
          <stop offset="100%" stopColor="#061532" />
        </linearGradient>
        <linearGradient id="pm-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fa6e6" stopOpacity="0" />
          <stop offset="100%" stopColor="#7fa6e6" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="pm-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a2247" stopOpacity="0" />
          <stop offset="100%" stopColor="#050f24" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* Ufuk parıltısı */}
      <rect x="0" y={BASE - 150} width={W} height="160" fill="url(#pm-glow)" />

      {/* Yıldızlar */}
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className="pm-twinkle" data-d={s.d} opacity={s.a} />
      ))}

      {/* Ay: hale, disk, hilal gölgesi, kraterler */}
      <circle cx="610" cy="66" r="78" fill="url(#pm-moon)" />
      <circle cx="610" cy="66" r="15" fill="#fbeac0" />
      <circle cx="616" cy="61" r="13" fill="#0b2250" opacity="0.5" />
      <circle cx="605" cy="71" r="2.2" fill="#d9bd7c" opacity="0.55" />
      <circle cx="611" cy="62" r="1.5" fill="#d9bd7c" opacity="0.5" />

      {/* İnce altın yay (ufuk) */}
      <path d="M-20 262 C 180 130, 480 80, 840 170" fill="none" stroke="#d4a24c" strokeWidth="1" opacity="0.38" />

      {/* Uzak siluet (sisli) */}
      <Roofs blds={FAR} fill="url(#pm-far)" />
      <rect x="0" y={BASE - 120} width={W} height="130" fill="url(#pm-mist)" />

      {/* Orta sıra */}
      <Roofs blds={MID} fill="url(#pm-mid)" />
      {MID.map((b, i) => (
        <rect key={i} x={b.x} y={BASE - b.h} width={b.w} height="1.2" fill="#d4a24c" opacity="0.2" />
      ))}
      {LIT_MID.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="3.4" height="5" rx="0.5" fill={w.warm ? "#f0c36a" : "#bcd4ff"} opacity="0.62" className={w.d ? "pm-twinkle" : undefined} data-d={w.d || undefined} />
      ))}

      {/* Ön sıra */}
      <Roofs blds={NEAR} fill="url(#pm-near)" />
      {NEAR.map((b, i) => (
        <rect key={i} x={b.x} y={BASE - b.h} width={b.w} height="1.4" fill="#d4a24c" opacity="0.3" />
      ))}
      {LIT_NEAR.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="4" height="6" rx="0.6" fill={w.warm ? "#f0c36a" : "#cfe0ff"} opacity="0.88" className={w.d ? "pm-twinkle" : undefined} data-d={w.d || undefined} />
      ))}

      {/* Alt sis + zemin */}
      <rect x="0" y={BASE - 56} width={W} height="70" fill="url(#pm-mist)" />
      <rect x="0" y={BASE - 36} width={W} height={H - BASE + 36} fill="url(#pm-ground)" />
    </svg>
  );
}
