/**
 * CityPanorama — DashboardHero'nun sağındaki zengin şehir panoraması (premium v6): üç duraklı gün batımı göğü,
 * güneş halesi ve ışın, iki hızda süzülen yumuşak bulutlar, kanat çırpan kuşlar, uzak tepe silüeti, üç derinlikte
 * gökdelen (yakın katmanda cam parıltısı + pencere ışıkları), asma köprü (tabliye ışıkları), su yüzeyi, kule
 * yansımaları, ışıldayan dalga çizgileri ve süzülen vapur. Saf SVG, dış görsel/telif/yazı tipi yok, deterministik.
 *
 * Renk: yalnız CSS değişkenleri (`console-premium.css` `.ds-hero-pano` → `--pano-*`, token karışımı; açıkta gün
 * batımı, koyuda gece + yanan pencereler; vurgu temasını izler). Hareket `app-motion.css` (`.pano-*`): yalnız
 * transform/opacity, hero görünür + sekme açıkken (`HeroPlay` `data-play`) oynar, pencere ışıkları bir kez yanar;
 * reduce'ta durağan. Dekoratif: aria-hidden. Kimlikler (`pano-*`) sayfada tek hero olduğu için sabittir.
 */
type Tower = readonly [x: number, w: number, h: number];

const BASE = 200;
/** Uzak katman (soluk), orta katman, yakın katman (pencereli, cam parıltılı). */
const FAR: readonly Tower[] = [
  [262, 14, 46], [280, 18, 62], [302, 12, 40], [446, 14, 58], [464, 18, 82], [486, 12, 54], [548, 16, 70], [676, 18, 64], [698, 14, 44], [742, 16, 58],
];
const MID: readonly Tower[] = [
  [420, 20, 70], [444, 16, 92], [520, 22, 84], [546, 14, 60], [624, 20, 98], [648, 16, 72], [712, 22, 80],
];
const NEAR: readonly Tower[] = [
  [470, 22, 106], [496, 16, 78], [574, 26, 128], [604, 18, 92], [664, 20, 112], [688, 14, 70], [736, 20, 96],
];

/** Kule + (yüksek kulelerde) üstte daralan kademe ve anten: düz blok yerine gerçek silüet. */
function towers(list: readonly Tower[], fill: string, cap = true) {
  return list.map(([x, w, h]) => (
    <g key={`${x}-${h}`} fill={fill}>
      <rect x={x} y={BASE - h} width={w} height={h} rx={1.5} />
      {cap && h > 70 ? <rect x={x + w * 0.2} y={BASE - h - 7} width={w * 0.6} height={8} rx={1} /> : null}
      {cap && h > 95 ? <rect x={x + w / 2 - 0.75} y={BASE - h - 18} width={1.5} height={12} /> : null}
    </g>
  ));
}

/** Köprü tabliyesi ışıkları (deterministik). */
const DECK_LIGHTS = Array.from({ length: 15 }, (_, i) => 150 + i * 20);

export function CityPanorama({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 760 240" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="pano-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pano-sky-a)" />
          <stop offset="0.62" stopColor="var(--pano-sky-b)" />
          <stop offset="1" stopColor="var(--pano-sky-c)" />
        </linearGradient>
        <linearGradient id="pano-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pano-water-a)" />
          <stop offset="1" stopColor="var(--pano-water-b)" />
        </linearGradient>
        <linearGradient id="pano-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--pano-glass)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--pano-glass)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--pano-glass)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pano-reflect" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pano-near)" stopOpacity="0.42" />
          <stop offset="1" stopColor="var(--pano-near)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="pano-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--pano-sun)" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="var(--pano-sun)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--pano-sun)" stopOpacity="0" />
        </radialGradient>
        <pattern id="pano-win" width="7" height="10" patternUnits="userSpaceOnUse">
          <rect x="2" y="2.5" width="3" height="4" rx="0.6" fill="var(--pano-win)" />
        </pattern>
      </defs>

      {/* gök + güneş halesi + ışın */}
      <rect width="760" height="240" fill="url(#pano-sky)" />
      <circle className="pano-sun-glow" cx="338" cy="168" r="110" fill="url(#pano-sun)" />
      <circle cx="338" cy="168" r="24" fill="var(--pano-sun)" opacity="0.85" />
      <g className="pano-rays" stroke="var(--pano-sun)" strokeWidth="1.2" strokeLinecap="round" opacity="0.35">
        <path d="M338 128v-18M310 140l-12-12M366 140l12-12M296 168h-18M380 168h18" />
      </g>

      {/* bulutlar: iki katman, farklı hızda */}
      <g className="pano-cloud" fill="var(--pano-cloud)" opacity="0.7">
        <ellipse cx="402" cy="52" rx="44" ry="8" />
        <ellipse cx="418" cy="44" rx="22" ry="10" />
        <ellipse cx="392" cy="46" rx="14" ry="7" />
      </g>
      <g className="pano-cloud2" fill="var(--pano-cloud)" opacity="0.5">
        <ellipse cx="636" cy="70" rx="38" ry="6" />
        <ellipse cx="648" cy="64" rx="18" ry="8" />
        <ellipse cx="270" cy="88" rx="30" ry="5" />
      </g>

      {/* kuşlar (kanat çırpar + süzülür) */}
      <g className="pano-bird" fill="none" stroke="var(--pano-deep)" strokeWidth="1.3" strokeLinecap="round" opacity="0.6">
        <path className="pano-wing" d="M452 96q4-4 8 0q4-4 8 0" />
        <path className="pano-wing pano-wing-2" d="M474 84q3-3 6 0q3-3 6 0" />
        <path className="pano-wing" d="M490 100q2.5-2.5 5 0q2.5-2.5 5 0" />
      </g>

      {/* uzak tepeler */}
      <path d="M150 200C210 176 250 182 300 172S392 160 440 176 560 166 620 178 720 168 760 174V200Z" fill="var(--pano-hill)" />

      {/* uzak ve orta silüet */}
      <g opacity="0.75">{towers(FAR, "var(--pano-far)")}</g>
      {towers(MID, "var(--pano-mid)")}

      {/* asma köprü (Boğaz esintisi): kule, ana kablo, askılar, tabliye + ışıklar */}
      <g fill="none" stroke="var(--pano-line)" strokeLinecap="round">
        <path d="M140 194Q205 150 222 128Q300 184 378 128Q395 150 460 194" strokeWidth="1.6" />
        <path d="M238 146v46M254 157v35M270 165v27M286 171v21M314 171v21M330 165v27M346 157v35M362 146v46M190 168v24M206 152v40M394 152v40M410 168v24" strokeWidth="0.8" opacity="0.75" />
        <path d="M120 195H480" strokeWidth="3" />
      </g>
      <rect x="219" y="124" width="6" height="72" rx="1.5" fill="var(--pano-line)" />
      <rect x="375" y="124" width="6" height="72" rx="1.5" fill="var(--pano-line)" />
      <g className="pano-lights" fill="var(--pano-win)" style={{ opacity: "var(--pano-lights-o, 0.5)" }}>
        {DECK_LIGHTS.map((x) => (
          <circle key={x} cx={x} cy={193.5} r={1.1} />
        ))}
        <circle cx="222" cy="122" r="1.6" />
        <circle cx="378" cy="122" r="1.6" />
      </g>

      {/* yakın gökdelenler + cam parıltısı + pencere ışıkları */}
      {towers(NEAR, "var(--pano-near)")}
      <g opacity="0.8">
        {NEAR.map(([x, w, h]) => (
          <rect key={`g${x}`} x={x + w * 0.12} y={BASE - h} width={w * 0.34} height={h} fill="url(#pano-glass)" />
        ))}
      </g>
      <g className="pano-lights" style={{ opacity: "var(--pano-lights-o, 0.5)" }}>{towers(NEAR, "url(#pano-win)", false)}</g>

      {/* su + kule yansımaları + ışıldayan dalga çizgileri */}
      <rect y={BASE} width="760" height={240 - BASE} fill="url(#pano-water)" />
      <g transform={`translate(0 ${BASE * 2}) scale(1 -1)`} opacity="0.9">
        {NEAR.map(([x, w, h]) => (
          <rect key={`r${x}`} x={x} y={BASE - Math.min(h, 40)} width={w} height={Math.min(h, 40)} fill="url(#pano-reflect)" />
        ))}
      </g>
      <path d={`M300 ${BASE + 4}h76M314 ${BASE + 12}h48M326 ${BASE + 20}h24M332 ${BASE + 28}h12`} stroke="var(--pano-sun)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" className="pano-shimmer" />
      <g className="pano-shimmer pano-shimmer-2" stroke="var(--pano-cloud)" strokeLinecap="round" strokeWidth="1.3" opacity="0.6">
        <path d={`M470 ${BASE + 9}h38M584 ${BASE + 15}h50M520 ${BASE + 25}h28M650 ${BASE + 31}h34M700 ${BASE + 12}h26M200 ${BASE + 18}h40`} />
      </g>

      {/* vapur */}
      <g className="pano-boat" fill="var(--pano-deep)" opacity="0.8">
        <path d={`M420 ${BASE + 18}h34l-4 5h-26Z`} />
        <rect x="428" y={BASE + 12} width="18" height="6" rx="1" />
        <rect x="436" y={BASE + 7} width="3" height="5" />
        <path d={`M424 ${BASE + 26}h28`} stroke="var(--pano-cloud)" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
      </g>

      {/* altın imza çizgisi */}
      <path className="pano-sign" d="M612 26q46 14 112-12" fill="none" stroke="var(--pano-gold)" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" pathLength={1} />
    </svg>
  );
}
