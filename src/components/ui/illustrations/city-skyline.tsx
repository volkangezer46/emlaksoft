/**
 * CitySkyline — soluk açık mavi İZOMETRİK şehir silüeti (DashboardHero sağı). Elle tanımlı
 * bloklar, saf SVG, dış görsel/telif yok, deterministik (sunucu = istemci). Renk tek kaynak
 * `currentColor` (çağıran `--hero-art` verir) + katman opaklıkları → açık ve koyu temada uyar.
 * Dekoratif: aria-hidden. Hareket yok (hero degradesi ayrı katmandır).
 */
const COS = 0.866;
const SIN = 0.5;

type Block = { x: number; y: number; a: number; b: number; h: number; win?: boolean };

/** Arkadan öne (y küçük = uzak) çizim sırası. */
const BLOCKS: readonly Block[] = [
  { x: 300, y: 194, a: 24, b: 28, h: 64 },
  { x: 446, y: 198, a: 30, b: 28, h: 84, win: true },
  { x: 354, y: 200, a: 28, b: 32, h: 118, win: true },
  { x: 404, y: 204, a: 26, b: 26, h: 150, win: true },
  { x: 494, y: 210, a: 28, b: 26, h: 58 },
  { x: 252, y: 214, a: 28, b: 28, h: 44 },
  { x: 532, y: 218, a: 22, b: 20, h: 36 },
];

const r = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number) => `${r(x)},${r(y)}`;

function faces({ x, y, a, b, h }: Block) {
  const lx = x - a * COS;
  const ly = y - a * SIN;
  const rx = x + b * COS;
  const ry = y - b * SIN;
  const bx = lx + b * COS;
  const by = ly - b * SIN;
  return {
    left: [pt(x, y), pt(lx, ly), pt(lx, ly - h), pt(x, y - h)].join(" "),
    right: [pt(x, y), pt(rx, ry), pt(rx, ry - h), pt(x, y - h)].join(" "),
    top: [pt(x, y - h), pt(lx, ly - h), pt(bx, by - h), pt(rx, ry - h)].join(" "),
  };
}

/** Sağ yüzde kat çizgileri (12 px aralık): "M x1,y1 L x2,y2 ..." tek yol. */
function windows({ x, y, b, h }: Block): string {
  const rx = x + b * COS;
  const ry = y - b * SIN;
  let d = "";
  for (let k = 14; k < h - 6; k += 12) d += `M${pt(x + 3, y - k - 1.7)}L${pt(rx - 3, ry - k + 1.7)}`;
  return d;
}

const TREES: readonly [number, number, number][] = [
  [328, 214, 10], [316, 219, 7], [470, 227, 9], [486, 229, 6.5], [214, 226, 8], [560, 230, 7],
];

export function CitySkyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 240" preserveAspectRatio="xMaxYMax meet" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      {/* bulutlar */}
      <g opacity="0.22">
        <rect x="150" y="54" width="76" height="16" rx="8" />
        <rect x="176" y="44" width="40" height="18" rx="9" />
        <rect x="470" y="34" width="64" height="14" rx="7" />
      </g>
      {/* tepeler */}
      <path d="M120 240C210 206 268 214 330 222S470 202 600 212V240Z" opacity="0.16" />
      <path d="M0 240C120 222 220 228 300 232S500 222 600 230V240Z" opacity="0.22" />
      {BLOCKS.map((blk) => {
        const f = faces(blk);
        return (
          <g key={`${blk.x}-${blk.y}`}>
            <polygon points={f.left} opacity="0.34" />
            <polygon points={f.right} opacity="0.2" />
            <polygon points={f.top} opacity="0.5" />
            {blk.win ? <path d={windows(blk)} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.32" /> : null}
          </g>
        );
      })}
      {/* ağaçlar */}
      <g opacity="0.42">
        {TREES.map(([cx, cy, rr]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy - rr} r={rr} />
        ))}
      </g>
    </svg>
  );
}
