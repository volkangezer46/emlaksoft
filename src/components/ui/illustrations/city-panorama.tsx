/**
 * CityPanorama — DashboardHero'nun sağındaki zengin şehir panoraması (premium v5): gün batımı göğü, güneş ışıltısı,
 * bulutlar, uzak/orta/yakın gökdelen katmanları (yakın katmanda pencere deseni), asma köprü, su ve yansımalar, kuşlar,
 * ince altın imza çizgisi. Saf SVG, dış görsel/telif/yazı tipi yok, deterministik (sunucu = istemci).
 *
 * Renk: yalnız CSS değişkenleri (`console-premium.css` `.ds-hero-pano` → `--pano-*`, token karışımı; açıkta gün
 * batımı, koyuda gece + yanan pencereler; vurgu temasını izler). Hareket `app-motion.css` (`.pano-*`): bulut/kuş
 * süzülmesi ve güneş ışıltısı yalnız hero görünür + sekme açıkken (`HeroPlay` `data-play`), pencere ışıkları bir kez
 * yanar; reduce'ta durağan. Dekoratif: aria-hidden. Kimlikler (`pano-*`) sayfada tek hero olduğu için sabittir.
 */
type Tower = readonly [x: number, w: number, h: number];

/** Uzak katman (soluk), orta katman, yakın katman (pencereli). Taban y = 204. */
const FAR: readonly Tower[] = [
  [300, 18, 58], [322, 14, 74], [340, 22, 50], [470, 16, 66], [490, 20, 92], [514, 14, 60], [690, 20, 70], [712, 16, 48],
];
const MID: readonly Tower[] = [
  [430, 22, 74], [456, 18, 96], [536, 24, 88], [566, 16, 66], [640, 22, 100], [666, 18, 76], [700, 24, 62],
];
const NEAR: readonly Tower[] = [
  [478, 24, 104], [506, 18, 76], [590, 28, 122], [622, 18, 88], [738, 20, 94],
];
const BASE = 204;

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

export function CityPanorama({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 760 240"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        <linearGradient id="pano-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pano-sky-a)" />
          <stop offset="1" stopColor="var(--pano-sky-b)" />
        </linearGradient>
        <linearGradient id="pano-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pano-water-a)" />
          <stop offset="1" stopColor="var(--pano-water-b)" />
        </linearGradient>
        <radialGradient id="pano-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--pano-sun)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--pano-sun)" stopOpacity="0" />
        </radialGradient>
        <pattern id="pano-win" width="8" height="11" patternUnits="userSpaceOnUse">
          <rect x="2.5" y="3" width="3" height="4" rx="0.6" fill="var(--pano-win)" />
        </pattern>
      </defs>

      {/* gök + güneş */}
      <rect width="760" height="240" fill="url(#pano-sky)" />
      <circle className="pano-sun-glow" cx="300" cy="164" r="92" fill="url(#pano-sun)" />
      <circle cx="300" cy="164" r="26" fill="var(--pano-sun)" opacity="0.8" />

      {/* bulutlar */}
      <g className="pano-cloud" fill="var(--pano-cloud)" opacity="0.55">
        <rect x="360" y="46" width="84" height="14" rx="7" />
        <rect x="384" y="36" width="44" height="16" rx="8" />
        <rect x="610" y="62" width="70" height="12" rx="6" />
      </g>

      {/* kuşlar */}
      <g className="pano-bird" fill="none" stroke="var(--pano-deep)" strokeWidth="1.4" strokeLinecap="round" opacity="0.55">
        <path d="M430 92q4-4 8 0q4-4 8 0" />
        <path d="M452 80q3-3 6 0q3-3 6 0" />
      </g>

      {/* uzak ve orta silüet */}
      <g opacity="0.7">{towers(FAR, "var(--pano-far)")}</g>
      {towers(MID, "var(--pano-mid)")}

      {/* asma köprü (Boğaz esintisi): kule, ana kablo, askılar, tabliye */}
      <g fill="none" stroke="var(--pano-line)" strokeLinecap="round">
        <path d="M150 196Q215 150 230 132Q300 186 370 132Q385 150 450 196" strokeWidth="1.6" />
        <path d="M246 150v42M262 160v34M278 168v26M294 174v20M322 174v20M338 168v26M354 160v34M198 170v24M214 156v38M386 156v38M402 170v24" strokeWidth="0.9" opacity="0.8" />
        <path d="M130 197H470" strokeWidth="3" />
      </g>
      <rect x="227" y="128" width="6" height="70" rx="1.5" fill="var(--pano-line)" />
      <rect x="367" y="128" width="6" height="70" rx="1.5" fill="var(--pano-line)" />

      {/* yakın gökdelenler + pencere ışıkları */}
      {towers(NEAR, "var(--pano-near)")}
      <g className="pano-lights" style={{ opacity: "var(--pano-lights-o, 0.5)" }}>{towers(NEAR, "url(#pano-win)", false)}</g>

      {/* su + yansımalar */}
      <rect y="204" width="760" height="36" fill="url(#pano-water)" />
      <g stroke="var(--pano-cloud)" strokeLinecap="round" opacity="0.5">
        <path d="M480 214h40M600 220h52M520 228h28M300 216h46M640 232h34" strokeWidth="1.4" />
        <path d="M282 214h36M292 224h18" stroke="var(--pano-sun)" strokeWidth="1.6" />
      </g>

      {/* altın imza çizgisi */}
      <path d="M612 28q46 14 112-12" fill="none" stroke="var(--pano-gold)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
