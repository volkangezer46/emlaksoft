import type { CSSProperties } from "react";
import type { FeaturedPreviewKind } from "@/lib/site-menu/schema";

/**
 * Mega menü öne çıkan kartı için ANİMASYONLU MİNİ ÜRÜN ÖNİZLEMESİ (medya yüklenmemişse). Satır içi SVG/HTML + CSS; dosya indirmez,
 * bağımlılık yok. Temel görünüm = SON KARE; hareket yalnız panel açıkken (.mk-dd[data-open="true"]) ve
 * `prefers-reduced-motion: no-preference` içinde bir kez oynar (marketing-sections.css, mk-mp-*). Fare takibi yok.
 * İçerik ÖRNEKTİR (sayı/isim uydurma yok); dekoratif olduğu için aria-hidden.
 */
const at = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

function Scene({ kind }: { kind: FeaturedPreviewKind }) {
  switch (kind) {
    case "leak":
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <path d="M20 26 H140" stroke="#7f9bd0" strokeWidth="2.5" strokeLinecap="round" />
          {[20, 60, 100, 140].map((x, i) => (
            <circle key={x} cx={x} cy="26" r="6" fill="#0b2152" stroke={i === 3 ? "#7be0c8" : "#9db9ff"} strokeWidth="2.5" />
          ))}
          <path className="mk-mp-p" style={at(0)} d="M100 26 C112 26 112 58 124 58" fill="none" stroke="#ff7a7f" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 5" />
          <circle className="mk-mp-p" style={at(1)} cx="124" cy="58" r="8" fill="#e5484d" />
          <rect x="22" y="68" width="116" height="14" rx="7" fill="rgba(255,255,255,.1)" />
          <rect className="mk-mp-x" x="22" y="68" width="116" height="14" rx="7" fill="rgba(229,72,77,.55)" />
        </svg>
      );
    case "valuation":
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect className="mk-mp-x" x="40" y="14" width="80" height="52" rx="8" fill="rgba(125,160,255,.22)" stroke="#9db9ff" strokeDasharray="3 4" />
          {[[26, 48], [48, 34], [66, 52], [84, 38], [98, 46], [112, 30], [134, 44]].map(([x, y], i) => (
            <circle key={i} className="mk-mp-p" style={at(i)} cx={x} cy={y} r={i === 4 ? 5 : 3.5} fill={i === 4 ? "#b9a3ff" : "#8fb4ff"} />
          ))}
          <path d="M14 72 H146" stroke="rgba(255,255,255,.25)" />
        </svg>
      );
    case "signature":
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect x="14" y="10" width="132" height="18" rx="9" fill="rgba(255,255,255,.12)" />
          <rect x="22" y="15" width="40" height="8" rx="4" fill="rgba(185,208,255,.7)" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} className="mk-mp-p" style={at(i)} x={20 + i * 25} y="36" width="20" height="22" rx="5" fill="rgba(255,255,255,.14)" stroke="rgba(185,208,255,.55)" />
          ))}
          <path className="mk-mp-d" pathLength={1} d="M18 78 C 28 62, 38 62, 42 74 S 56 80, 66 68 S 86 62, 92 74 S 112 80, 124 66 S 140 70, 144 72" fill="none" stroke="#9db9ff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "plans":
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={18 + i * 46} y="10" width="40" height="70" rx="8" fill="rgba(255,255,255,.1)" stroke={i === 1 ? "#9db9ff" : "rgba(255,255,255,.18)"} />
              <rect className="mk-mp-b" style={at(i)} x={26 + i * 46} y={58 - i * 12} width="24" height={14 + i * 12} rx="4" fill={i === 1 ? "#8fb4ff" : "rgba(185,208,255,.55)"} />
              <rect x={26 + i * 46} y="20" width="24" height="5" rx="2.5" fill="rgba(255,255,255,.4)" />
            </g>
          ))}
        </svg>
      );
    case "assistant":
      return (
        <svg viewBox="0 0 160 90" focusable="false">
          <rect className="mk-mp-r" style={at(0)} x="44" y="10" width="102" height="22" rx="10" fill="#6b7cff" />
          <rect x="54" y="18" width="70" height="5" rx="2.5" fill="rgba(255,255,255,.85)" />
          <rect className="mk-mp-r" style={at(1)} x="14" y="40" width="112" height="38" rx="10" fill="rgba(255,255,255,.14)" />
          <rect x="24" y="49" width="88" height="5" rx="2.5" fill="rgba(255,255,255,.7)" />
          <rect x="24" y="60" width="62" height="5" rx="2.5" fill="rgba(255,255,255,.45)" />
        </svg>
      );
  }
}

export function FeaturedPreview({ kind }: { kind: FeaturedPreviewKind }) {
  return (
    <span className="mk-prev" data-kind={kind} aria-hidden="true">
      <Scene kind={kind} />
      <em className="mk-prev-tag">Örnek ekran · örnek veri</em>
    </span>
  );
}
