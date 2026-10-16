/**
 * Ana ekran kahramanının ÇİZİMİ: şehir silüeti + modern villa (havuz, ağaçlar, cam cephe), saate göre sahne
 * (gündüz · gün batımı · gece; koyu temada her zaman gece). SUNUCUDA çizilir (istemci JS'i yok), renkler CSS
 * değişkenlerinden (`.hs` kuralları, home-kurumsal.css): tema ve sahne yalnız değişken değiştirir. Hareket (bulut süzülmesi,
 * kuş kanadı, pencere ışığı) yalnız `prefers-reduced-motion: no-preference` ve yumuşak gezinme dışında; transform/opacity.
 * Dekoratiftir (`aria-hidden`); ofisin yayındaki portföy fotoğrafı varsa üstüne biner.
 */
export function HeroScene({ scene }: { scene: "day" | "dusk" | "night" }) {
  return (
    <svg viewBox="0 0 800 320" preserveAspectRatio="xMaxYMax slice" className="hs h-full w-full" data-scene={scene} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="hs-sky-a" />
          <stop offset="0.62" className="hs-sky-b" />
          <stop offset="1" className="hs-sky-c" />
        </linearGradient>
        <linearGradient id="hs-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="hs-glass-a" />
          <stop offset="1" className="hs-glass-b" />
        </linearGradient>
        <linearGradient id="hs-tower" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="hs-tower-a" />
          <stop offset="1" className="hs-tower-b" />
        </linearGradient>
        <linearGradient id="hs-pool" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="hs-pool-a" />
          <stop offset="1" className="hs-pool-b" />
        </linearGradient>
        <radialGradient id="hs-sunglow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="hs-glow-a" />
          <stop offset="1" className="hs-glow-b" />
        </radialGradient>
        <pattern id="hs-win" width="9" height="11" patternUnits="userSpaceOnUse">
          <rect x="2" y="2" width="4" height="6" rx="0.6" className="hs-win" />
        </pattern>
      </defs>

      <rect width="800" height="320" fill="url(#hs-sky)" />

      {/* Güneş / ay + yıldızlar */}
      <circle cx="610" cy="92" r="88" fill="url(#hs-sunglow)" className="hs-sunglow" />
      <circle cx="610" cy="92" r="30" className="hs-sun" />
      <g className="hs-moon">
        <circle cx="610" cy="86" r="22" />
        <circle cx="620" cy="80" r="19" className="hs-moon-cut" />
      </g>
      <g className="hs-stars">
        <circle cx="420" cy="40" r="1.4" />
        <circle cx="480" cy="72" r="1" />
        <circle cx="540" cy="30" r="1.6" />
        <circle cx="700" cy="44" r="1.2" />
        <circle cx="760" cy="96" r="1" />
        <circle cx="660" cy="150" r="0.9" />
        <circle cx="360" cy="86" r="1.1" />
      </g>

      {/* Bulutlar */}
      <g className="hs-cloud hs-cloud-1">
        <path d="M430 74c0-11 9-19 20-19 6-11 24-14 33-4 13-3 25 6 25 18 9 1 15 7 15 14H415c0-5 6-9 15-9z" />
      </g>
      <g className="hs-cloud hs-cloud-2">
        <path d="M660 140c0-8 7-14 15-14 5-8 18-10 25-3 10-2 19 5 19 13 7 1 11 5 11 10H648c0-4 5-6 12-6z" />
      </g>
      <g className="hs-cloud hs-cloud-3">
        <path d="M300 116c0-7 6-12 13-12 4-7 16-9 22-2 8-2 16 4 16 11 6 1 9 4 9 8H290c0-3 4-5 10-5z" />
      </g>

      {/* Kuşlar */}
      <g className="hs-birds" fill="none" strokeWidth="1.6" strokeLinecap="round">
        <path className="hs-bird" d="M520 112q5-5 9 0q4-5 9 0" />
        <path className="hs-bird hs-bird-2" d="M548 98q4-4 7 0q3-4 7 0" />
        <path className="hs-bird hs-bird-3" d="M500 96q3-3 6 0q3-3 6 0" />
      </g>

      {/* Uzak dağlar */}
      <path className="hs-mtn" d="M180 214l70-46 46 26 64-52 72 44 52-30 84 48 60-34 78 40 94-36v140H180z" />

      {/* Arka şehir */}
      <g className="hs-city-back">
        <rect x="250" y="150" width="26" height="90" />
        <rect x="280" y="128" width="20" height="112" />
        <rect x="304" y="160" width="30" height="80" />
        <rect x="338" y="112" width="22" height="128" />
        <rect x="364" y="140" width="28" height="100" />
        <rect x="396" y="96" width="24" height="144" />
        <rect x="424" y="132" width="34" height="108" />
        <rect x="462" y="150" width="22" height="90" />
        <rect x="488" y="118" width="26" height="122" />
      </g>
      {/* Ön şehir: pencereli kuleler */}
      <g className="hs-city-front">
        <g fill="url(#hs-tower)">
          <rect x="300" y="146" width="34" height="98" rx="2" />
          <rect x="342" y="118" width="40" height="126" rx="2" />
          <rect x="390" y="88" width="30" height="156" rx="2" />
          <rect x="428" y="128" width="44" height="116" rx="2" />
          <rect x="480" y="104" width="32" height="140" rx="2" />
          <rect x="518" y="140" width="26" height="104" rx="2" />
        </g>
        <g fill="url(#hs-win)" className="hs-windows">
          <rect x="303" y="152" width="28" height="88" />
          <rect x="345" y="124" width="34" height="116" />
          <rect x="393" y="94" width="24" height="146" />
          <rect x="431" y="134" width="38" height="106" />
          <rect x="483" y="110" width="26" height="130" />
          <rect x="521" y="146" width="20" height="94" />
        </g>
        <path className="hs-spire" d="M405 88V66l2-4 2 4v22z" />
      </g>

      {/* Zemin, çim, ağaçlar */}
      <path className="hs-lawn-back" d="M180 250c90-14 210-18 330-14s200 6 290-2v86H180z" />
      <g className="hs-trees-back">
        <ellipse cx="560" cy="226" rx="9" ry="26" />
        <ellipse cx="576" cy="230" rx="7" ry="20" />
        <circle cx="770" cy="214" r="22" />
        <circle cx="752" cy="226" r="16" />
      </g>

      {/* Modern villa */}
      <g className="hs-villa">
        <rect x="590" y="236" width="196" height="10" className="hs-slab" />
        <rect x="600" y="186" width="120" height="52" className="hs-wall" />
        <rect x="606" y="192" width="70" height="42" fill="url(#hs-glass)" className="hs-glass" />
        <path d="M641 192v42M623 192v42M659 192v42" className="hs-mullion" />
        <rect x="682" y="196" width="32" height="38" className="hs-wall-2" />
        <rect x="688" y="204" width="20" height="30" fill="url(#hs-glass)" className="hs-glass" />
        <rect x="628" y="146" width="150" height="40" className="hs-wall" />
        <rect x="620" y="140" width="166" height="8" className="hs-roof" />
        <rect x="636" y="152" width="96" height="30" fill="url(#hs-glass)" className="hs-glass" />
        <path d="M660 152v30M684 152v30M708 152v30" className="hs-mullion" />
        <rect x="738" y="152" width="34" height="30" className="hs-wood" />
        <path d="M738 159h34M738 166h34M738 173h34" className="hs-wood-line" />
        <rect x="592" y="182" width="136" height="5" className="hs-roof" />
        {/* İç ışık (gün batımı / gece) */}
        <rect x="606" y="192" width="70" height="42" className="hs-lit" />
        <rect x="636" y="152" width="96" height="30" className="hs-lit hs-lit-2" />
        <rect x="688" y="204" width="20" height="30" className="hs-lit hs-lit-3" />
      </g>
      {/* Havuz */}
      <path d="M596 252h150l-10 12H586z" fill="url(#hs-pool)" className="hs-pool" />
      <path d="M612 258h40M670 258h46" className="hs-pool-shine" />
      {/* Ön ağaçlar ve çim */}
      <g className="hs-trees-front">
        <ellipse cx="580" cy="230" rx="11" ry="34" />
        <circle cx="792" cy="230" r="20" />
        <rect x="578.5" y="250" width="3" height="16" className="hs-trunk" />
      </g>
      <path className="hs-lawn" d="M180 268c120-10 280-12 420-6s150 4 200-2v60H180z" />
    </svg>
  );
}
