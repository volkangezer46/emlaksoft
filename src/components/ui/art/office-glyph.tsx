/**
 * Ofis logosu yokken yan menü ofis kartının küçük çizimi: gökyüzü, güneş ve iki cam bina. Renkler kabuk
 * değişkenlerinden (`--art-*`, console-premium.css); iki temada aynı lacivert menü zemininde okunur.
 */
export function OfficeGlyph() {
  return (
    <svg viewBox="0 0 40 40" className="art-office h-full w-full" aria-hidden="true">
      <rect width="40" height="40" className="ao-sky" />
      <circle cx="31" cy="10" r="4" className="ao-sun" />
      <path d="M6 40V18l9-5 9 5v22z" className="ao-a" />
      <path d="M22 40V12l7-4 7 4v28z" className="ao-b" />
      <g className="ao-win">
        <rect x="9" y="21" width="3" height="3" rx=".5" />
        <rect x="16" y="21" width="3" height="3" rx=".5" />
        <rect x="9" y="27" width="3" height="3" rx=".5" />
        <rect x="16" y="27" width="3" height="3" rx=".5" />
        <rect x="26" y="16" width="2.5" height="2.5" rx=".5" />
        <rect x="31" y="16" width="2.5" height="2.5" rx=".5" />
        <rect x="26" y="22" width="2.5" height="2.5" rx=".5" />
        <rect x="31" y="22" width="2.5" height="2.5" rx=".5" />
        <rect x="26" y="28" width="2.5" height="2.5" rx=".5" />
        <rect x="31" y="28" width="2.5" height="2.5" rx=".5" />
      </g>
      <rect x="12.5" y="33" width="5" height="7" className="ao-door" />
      <path d="M0 38h40v2H0z" className="ao-ground" />
    </svg>
  );
}
