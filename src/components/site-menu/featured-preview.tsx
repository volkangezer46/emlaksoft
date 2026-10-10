import type { CSSProperties, ReactNode } from "react";
import type { SceneKind } from "@/lib/site-menu/previews";

export { SCENE_COPY } from "./scene-copy";

/**
 * Mega menü öne çıkan kartı için ANİMASYONLU MİNİ ÜRÜN SAHNELERİ: her alt menü öğesinin KENDİ sahnesi vardır. Satır içi SVG
 * + CSS; dosya indirmez, bağımlılık yok. Hepsi TEK tembel parçadır (menüye ilk yaklaşmada yüklenir; ilk HTML/JS'te yoktur).
 * Renkler `.mk-prev-stack` üzerindeki `--mp-*` token'larından gelir (sabit hex yok). Temel görünüm = SON KARE; hareket yalnız
 * etkin katmanda (`.mk-prev-layer[data-on="true"]`) ve `prefers-reduced-motion: no-preference` içinde oynar (marketing-sections.css,
 * mk-mp-*; yalnız transform/opacity/stroke-dashoffset). Fare konumu izlenmez. Dekoratif olduğu için aria-hidden.
 * ÖNEMLİ: animasyonlu öğede `transform` özniteliği olmaz (CSS ezer); konum için dış `<g transform>` kullanılır.
 * Kimlik (id) kullanılmaz: aynı sahne birden çok panelde güvenle tekrar edebilir.
 */
const at = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

type Scene = () => ReactNode;

const Dashboard: Scene = () => (
  <>
    <rect x="6" y="6" width="26" height="78" rx="6" fill="var(--mp-deep)" />
    <rect x="11" y="16" width="16" height="5" rx="2.5" fill="var(--mp-blue)" />
    {[28, 37, 46].map((y) => (
      <rect key={y} x="11" y={y} width="14" height="3" rx="1.5" fill="var(--mp-line)" />
    ))}
    {[0, 1, 2].map((i) => (
      <g key={i} className="mk-mp-r" style={at(i)}>
        <rect x={38 + i * 39} y="8" width="34" height="22" rx="5" fill="var(--mp-soft)" />
        <rect x={43 + i * 39} y="13" width="12" height="3" rx="1.5" fill="var(--mp-line)" />
        <rect x={43 + i * 39} y="20" width={[18, 14, 20][i]} height="5" rx="2" fill="var(--mp-ink)" opacity="0.8" />
      </g>
    ))}
    <rect x="38" y="36" width="112" height="48" rx="6" fill="var(--mp-soft)" />
    <path className="mk-mp-f" d="M44 74 C 58 72, 64 66, 76 66 S 96 54, 108 52 S 130 44, 144 42 V78 H44 Z" fill="var(--mp-gold)" opacity="0.2" />
    <path className="mk-mp-d" pathLength={1} d="M44 74 C 58 72, 64 66, 76 66 S 96 54, 108 52 S 130 44, 144 42" fill="none" stroke="var(--mp-gold)" strokeWidth="2.2" strokeLinecap="round" />
    <circle className="mk-mp-p" style={at(6)} cx="144" cy="42" r="3.2" fill="var(--mp-gold)" stroke="var(--mp-card)" strokeWidth="1.5" />
  </>
);

const Commission: Scene = () => (
  <>
    <path className="mk-mp-d" pathLength={1} d="M30 30 H80 H130" fill="none" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" />
    {[["Teklif", 30], ["Anlaşma", 80], ["Hakediş", 130]].map(([t, x], i) => (
      <g key={t as string} transform={`translate(${x} 30)`}>
        <g className="mk-mp-p" style={at(i * 2)}>
          <circle r="9" fill={i === 2 ? "var(--mp-gold)" : "var(--mp-blue)"} />
          <path d="M-3.5 0 l2.6 2.8 l4.6 -5" fill="none" stroke="var(--mp-card)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text y="22" textAnchor="middle" fontSize="6" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">{t}</text>
      </g>
    ))}
    <rect x="14" y="56" width="132" height="22" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    <text x="22" y="65" fontSize="5.5" fontWeight="700" fill="var(--mp-ink)" opacity="0.8">Kadıköy 3+1 · komisyon paylaşımı</text>
    <rect x="22" y="69" width="116" height="5" rx="2.5" fill="var(--mp-soft-2)" />
    <rect className="mk-mp-x" style={at(2)} x="22" y="69" width="70" height="5" rx="2.5" fill="var(--mp-blue)" />
    <rect className="mk-mp-x" style={at(4)} x="92" y="69" width="46" height="5" rx="2.5" fill="var(--mp-gold)" />
  </>
);

const Leak: Scene = () => (
  <>
    <g transform="translate(46 46)">
      {[34, 23, 12].map((r) => (
        <circle key={r} r={r} fill="none" stroke="var(--mp-line)" />
      ))}
      <path d="M-34 0 H34 M0 -34 V34" stroke="var(--mp-line)" strokeDasharray="2 3" />
      <g className="mk-mp-spin">
        <circle r="34" fill="none" />
        <path d="M0 0 L0 -34 A34 34 0 0 1 29.4 -17 Z" fill="var(--mp-mint)" opacity="0.22" />
        <path d="M0 0 L29.4 -17" stroke="var(--mp-mint)" strokeWidth="1.5" />
      </g>
      <circle className="mk-mp-p" style={at(1)} cx="-14" cy="-18" r="3" fill="var(--mp-blue)" />
      <circle className="mk-mp-p" style={at(2)} cx="18" cy="10" r="3" fill="var(--mp-blue)" />
      <circle className="mk-mp-p" style={at(3)} cx="-20" cy="16" r="3" fill="var(--mp-blue)" />
      <circle className="mk-mp-p" style={at(4)} cx="10" cy="-22" r="7" fill="none" stroke="var(--mp-danger)" strokeWidth="1.5" />
      <circle className="mk-mp-p" style={at(4)} cx="10" cy="-22" r="3.5" fill="var(--mp-danger)" />
    </g>
    {["Kadıköy", "Ataşehir", "Beşiktaş"].map((n, i) => (
      <g key={n} transform={`translate(92 ${16 + i * 22})`}>
        <text y="6" fontSize="5.5" fontWeight="700" fill="var(--mp-ink)" opacity="0.8">{n}</text>
        <rect y="9" width="56" height="5" rx="2.5" fill="var(--mp-soft)" />
        <rect className="mk-mp-x" style={at(i)} y="9" width={[44, 26, 14][i]} height="5" rx="2.5" fill={i === 0 ? "var(--mp-danger)" : "var(--mp-blue)"} />
      </g>
    ))}
  </>
);

const Valuation: Scene = () => (
  <>
    <path d="M14 76 H148 M14 76 V12" stroke="var(--mp-line)" />
    <rect className="mk-mp-f" x="14" y="30" width="134" height="20" fill="var(--mp-blue)" opacity="0.14" />
    {[[24, 62], [38, 55], [50, 58], [64, 46], [78, 49], [92, 40], [106, 42], [120, 33], [136, 30]].map(([x, y], i) => (
      <circle key={i} className="mk-mp-p" style={at(i)} cx={x} cy={y} r="2.6" fill="var(--mp-sky)" />
    ))}
    <path className="mk-mp-d" pathLength={1} d="M18 64 C 48 58, 66 50, 86 44 S 124 34, 146 28" fill="none" stroke="var(--mp-blue)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M86 44 V76" stroke="var(--mp-gold)" strokeDasharray="2 3" />
    <circle className="mk-mp-p" style={at(9)} cx="86" cy="44" r="5" fill="var(--mp-gold)" stroke="var(--mp-card)" strokeWidth="2" />
    <text x="94" y="16" fontSize="5.5" fontWeight="700" fill="var(--mp-ink)" opacity="0.8">Kadıköy · Ataşehir emsalleri</text>
  </>
);

const Parcel: Scene = () => (
  <>
    {[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4].map((c) => ({ r, c }))).map(({ r, c }) => {
      const hit = r === 1 && c === 2;
      return hit ? null : (
        <rect key={`${r}-${c}`} x={12 + c * 17} y={10 + r * 17} width="15" height="15" rx="2.5" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      );
    })}
    <g className="mk-mp-p" style={at(2)}>
      <rect x="46" y="27" width="15" height="15" rx="2.5" fill="var(--mp-gold)" opacity="0.9" />
    </g>
    <path className="mk-mp-d" pathLength={1} d="M61 34 H98 V26" fill="none" stroke="var(--mp-gold)" strokeWidth="1.5" strokeLinecap="round" />
    <g className="mk-mp-r" style={at(3)}>
      <rect x="98" y="12" width="52" height="24" rx="6" fill="var(--mp-soft-2)" stroke="var(--mp-gold)" />
      <text x="104" y="22" fontSize="5.5" fontWeight="700" fill="var(--mp-ink)">Ada 482 · Parsel 11</text>
      <text x="104" y="31" fontSize="5" fill="var(--mp-ink)" opacity="0.7">Kadıköy</text>
    </g>
    <g className="mk-mp-r" style={at(5)}>
      <rect x="98" y="46" width="52" height="30" rx="6" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      <rect x="104" y="52" width="26" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
      <rect x="104" y="60" width="38" height="3" rx="1.5" fill="var(--mp-line)" />
      <rect x="104" y="66" width="16" height="6" rx="3" fill="var(--mp-danger)" />
      <text x="107" y="70.6" fontSize="4.2" fontWeight="800" fill="var(--mp-card)">PDF</text>
    </g>
  </>
);

const Signature: Scene = () => (
  <>
    <rect x="30" y="8" width="84" height="74" rx="8" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x="40" y={18 + i * 9} width={[60, 52, 64, 40][i]} height="4" rx="2" fill="var(--mp-line)" />
    ))}
    <path d="M40 70 H104" stroke="var(--mp-line)" strokeDasharray="3 3" />
    <path className="mk-mp-d" pathLength={1} d="M42 66 C 48 52, 54 54, 56 63 S 66 70, 72 58 S 84 54, 88 64 S 98 62, 104 58" fill="none" stroke="var(--mp-sky)" strokeWidth="2.2" strokeLinecap="round" />
    <g className="mk-mp-p" style={at(5)}>
      <circle cx="118" cy="22" r="11" fill="var(--mp-mint)" />
      <path d="M113 22 l3.5 3.5 l6.5 -7" fill="none" stroke="var(--mp-card)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <rect className="mk-mp-r" style={at(1)} x="112" y="60" width="34" height="14" rx="7" fill="var(--mp-blue)" />
    <rect x="120" y="65.5" width="18" height="3" rx="1.5" fill="var(--mp-card)" opacity="0.8" />
  </>
);

const Automation: Scene = () => (
  <>
    <path className="mk-mp-d" pathLength={1} d="M42 45 H62 M98 45 C108 45, 108 24, 118 24 M98 45 C108 45, 108 66, 118 66" fill="none" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" />
    <g className="mk-mp-p" style={at(0)}>
      <rect x="12" y="33" width="30" height="24" rx="7" fill="var(--mp-blue)" />
      <path d="M24 39 l-4 7 h5 l-2 6 l7 -9 h-5 l2 -4 Z" fill="var(--mp-card)" />
    </g>
    <g className="mk-mp-p" style={at(2)}>
      <rect x="62" y="31" width="36" height="28" rx="8" fill="var(--mp-soft-2)" stroke="var(--mp-gold)" />
      <rect x="70" y="40" width="20" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
      <rect x="70" y="47" width="12" height="3" rx="1.5" fill="var(--mp-line)" />
    </g>
    {[24, 66].map((y, i) => (
      <g key={y} className="mk-mp-p" style={at(4 + i)}>
        <rect x="118" y={y - 10} width="30" height="20" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
        <circle cx="127" cy={y} r="3" fill={i === 0 ? "var(--mp-mint)" : "var(--mp-sky)"} />
        <rect x="133" y={y - 1.5} width="10" height="3" rx="1.5" fill="var(--mp-ink)" opacity="0.6" />
      </g>
    ))}
  </>
);

const Assistant: Scene = () => (
  <>
    <rect className="mk-mp-r" style={at(0)} x="40" y="8" width="106" height="20" rx="10" fill="var(--mp-blue)" />
    <text x="50" y="21" fontSize="6" fontWeight="700" fill="var(--mp-card)">Ataşehir’de 3+1 talepleri?</text>
    <g className="mk-mp-r" style={at(1)}>
      <rect x="14" y="36" width="112" height="40" rx="10" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      <rect x="24" y="45" width="80" height="4" rx="2" fill="var(--mp-ink)" opacity="0.75" />
      <rect x="24" y="54" width="58" height="4" rx="2" fill="var(--mp-ink)" opacity="0.45" />
      <rect x="24" y="63" width="34" height="5" rx="2.5" fill="var(--mp-mint)" opacity="0.5" />
      <text x="62" y="67.5" fontSize="6" fontWeight="700" fill="var(--mp-ink)" opacity="0.7">05•• ••• •• ••</text>
    </g>
    <path className="mk-mp-p" style={at(3)} d="M140 44 l2.2 5.8 l5.8 2.2 l-5.8 2.2 l-2.2 5.8 l-2.2 -5.8 l-5.8 -2.2 l5.8 -2.2 Z" fill="var(--mp-gold)" />
  </>
);

const Showcase: Scene = () => (
  <>
    <rect x="10" y="8" width="140" height="74" rx="8" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    <path d="M10 20 H150" stroke="var(--mp-line)" />
    {[0, 1, 2].map((i) => (
      <circle key={i} cx={18 + i * 7} cy="14" r="1.8" fill="var(--mp-line)" />
    ))}
    <rect x="48" y="11" width="64" height="6" rx="3" fill="var(--mp-soft-2)" />
    {[["Moda 2+1", "Kadıköy"], ["Etiler 3+1", "Beşiktaş"], ["Barbaros 1+1", "Ataşehir"]].map(([t, d], i) => (
      <g key={t} className="mk-mp-r" style={at(i)}>
        <rect x={16 + i * 44} y="27" width="40" height="48" rx="5" fill="var(--mp-soft-2)" />
        <rect x={16 + i * 44} y="27" width="40" height="22" rx="5" fill={["var(--mp-blue)", "var(--mp-sky)", "var(--mp-mint)"][i]} opacity="0.55" />
        <text x={20 + i * 44} y="58" fontSize="5" fontWeight="700" fill="var(--mp-ink)">{t}</text>
        <text x={20 + i * 44} y="66" fontSize="4.6" fill="var(--mp-ink)" opacity="0.65">{d}</text>
      </g>
    ))}
    <g className="mk-mp-p" style={at(5)}>
      <rect x="116" y="9.5" width="30" height="9" rx="4.5" fill="var(--mp-gold)" />
      <rect x="125" y="13" width="12" height="2.4" rx="1.2" fill="var(--mp-card)" opacity="0.7" />
    </g>
  </>
);

const Listing: Scene = () => (
  <>
    {[0, 1, 2, 3].map((i) => (
      <g key={i} transform={`translate(14 ${10 + i * 19})`}>
        <rect width="132" height="15" rx="5" fill="var(--mp-soft)" />
        <rect x="4" y="3" width="14" height="9" rx="2.5" fill="var(--mp-line)" />
        <text x="24" y="7.2" fontSize="4.8" fontWeight="700" fill="var(--mp-ink)" opacity="0.8">{["Kadıköy · Fenerbahçe 3+1", "Beşiktaş · Levent 2+1", "Ataşehir · İçerenköy 4+1", "Üsküdar · Acıbadem 2+1"][i]}</text>
        <rect x="24" y="9.5" width={[30, 36, 24, 32][i]} height="2.5" rx="1.25" fill="var(--mp-line)" />
        <circle className="mk-mp-p" style={at(i + 1)} cx="122" cy="7.5" r="4" fill={["var(--mp-mint)", "var(--mp-mint)", "var(--mp-danger)", "var(--mp-gold)"][i]} />
      </g>
    ))}
    <rect className="mk-mp-scan" x="10" y="8" width="140" height="2" rx="1" fill="var(--mp-sky)" />
  </>
);

const Tv: Scene = () => (
  <>
    <rect x="14" y="6" width="132" height="66" rx="7" fill="var(--mp-deep)" stroke="var(--mp-sky)" strokeWidth="1.5" />
    <path d="M62 82 H98 M80 72 V82" stroke="var(--mp-line)" strokeWidth="3" strokeLinecap="round" />
    <text x="22" y="19" fontSize="6.5" fontWeight="800" fill="var(--mp-ink)">Bugün · Randevular</text>
    <circle className="mk-mp-ring" cx="134" cy="15" r="4" fill="none" stroke="var(--mp-mint)" strokeWidth="1.2" />
    <circle cx="134" cy="15" r="2.4" fill="var(--mp-mint)" />
    {[["10:30", "Kadıköy", 62], ["13:00", "Beşiktaş", 50], ["15:30", "Ataşehir", 70]].map(([h, t, w], i) => (
      <g key={h as string} className="mk-mp-slide" style={at(i)}>
        <rect x="22" y={26 + i * 13} width="70" height="10" rx="5" fill="var(--mp-soft-2)" />
        <text x="27" y={33 + i * 13} fontSize="4.8" fontWeight="800" fill="var(--mp-gold)">{h}</text>
        <text x="46" y={33 + i * 13} fontSize="4.6" fill="var(--mp-ink)" opacity="0.85">{t}</text>
        <rect x="100" y={29 + i * 13} width={(w as number) * 0.6} height="4" rx="2" fill="var(--mp-line)" />
      </g>
    ))}
    {[18, 28, 22, 36].map((h, i) => (
      <rect key={i} className="mk-mp-b" style={at(i + 2)} x={102 + i * 11} y={66 - h * 0.9} width="7" height={h * 0.9} rx="2" fill={i === 3 ? "var(--mp-gold)" : "var(--mp-blue)"} />
    ))}
  </>
);

const Modules: Scene = () => (
  <>
    {[["Müşteriler", 1], ["Portföy", 1], ["Vitrin", 1], ["Muhasebe", 0]].map(([t, on], i) => (
      <g key={t as string} className="mk-mp-r" style={at(i)}>
        <rect x="14" y={6 + i * 17} width="132" height="14" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
        <text x="24" y={15.4 + i * 17} fontSize="6" fontWeight="700" fill="var(--mp-ink)" opacity={on ? 0.9 : 0.5}>{t}</text>
        <rect x="116" y={8.5 + i * 17} width="24" height="9" rx="4.5" fill={on ? "var(--mp-mint)" : "var(--mp-line)"} />
        <circle className="mk-mp-th" style={at(i)} cx={on ? 135.5 : 121.5} cy={13 + i * 17} r="3.2" fill="var(--mp-card)" />
      </g>
    ))}
  </>
);

const Why: Scene = () => (
  <>
    <g opacity="0.8">
      <rect x="8" y="12" width="62" height="62" rx="6" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      {[0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((c) => ({ r, c }))).map(({ r, c }) => (
        <rect key={`${r}${c}`} x={12 + c * 19} y={18 + r * 13} width="16" height="9" rx="1.5" fill="none" stroke="var(--mp-line)" />
      ))}
      <text x="12" y="10" fontSize="5" fontWeight="700" fill="var(--mp-ink)" opacity="0.6">Excel · defter</text>
    </g>
    <path className="mk-mp-d" pathLength={1} d="M12 20 L66 70 M66 20 L12 70" stroke="var(--mp-danger)" strokeWidth="1.6" strokeLinecap="round" />
    <path className="mk-mp-d" pathLength={1} d="M74 45 H88" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" />
    <g className="mk-mp-r" style={at(3)}>
      <rect x="92" y="12" width="60" height="62" rx="7" fill="var(--mp-soft-2)" stroke="var(--mp-blue)" />
      <text x="98" y="10" fontSize="5" fontWeight="700" fill="var(--mp-ink)">EmlakSoft</text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle cx="102" cy={26 + i * 16} r="4" fill="var(--mp-mint)" />
          <path d={`M100 ${26 + i * 16} l1.6 1.8 l3 -3.4`} fill="none" stroke="var(--mp-card)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="110" y={23 + i * 16} width={[34, 28, 32][i]} height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
          <rect x="110" y={29.5 + i * 16} width="20" height="2.5" rx="1.25" fill="var(--mp-line)" />
        </g>
      ))}
    </g>
  </>
);

const Setup: Scene = () => (
  <>
    <rect x="14" y="8" width="132" height="72" rx="10" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    <text x="24" y="22" fontSize="6.2" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">Kullanıcı sayısı</text>
    <rect x="24" y="30" width="112" height="4" rx="2" fill="var(--mp-soft-2)" />
    <rect className="mk-mp-x" style={at(0)} x="24" y="30" width="62" height="4" rx="2" fill="var(--mp-blue)" />
    <g className="mk-mp-p" style={at(3)}>
      <circle cx="86" cy="32" r="6" fill="var(--mp-ink)" stroke="var(--mp-blue)" strokeWidth="2" />
    </g>
    <g className="mk-mp-r" style={at(1)}>
      <rect x="24" y="44" width="46" height="14" rx="7" fill="var(--mp-soft-2)" />
      <text x="31" y="53.5" fontSize="6" fontWeight="700" fill="var(--mp-ink)">6 kullanıcı</text>
      <rect x="76" y="44" width="60" height="14" rx="7" fill="var(--mp-gold)" />
      <text x="83" y="53.5" fontSize="6" fontWeight="800" fill="var(--mp-card)">Fiyat anında</text>
    </g>
    <rect className="mk-mp-ring" x="22" y="62" width="76" height="14" rx="7" fill="none" stroke="var(--mp-sky)" strokeWidth="1.5" />
    <g className="mk-mp-r" style={at(2)}>
      <rect x="24" y="64" width="72" height="11" rx="5.5" fill="var(--mp-blue)" />
      <text x="33" y="71.8" fontSize="6" fontWeight="800" fill="var(--mp-card)">Ücretsiz dene</text>
    </g>
  </>
);

const Person = ({ x, y, c, i }: { x: number; y: number; c: string; i: number }) => (
  <g className="mk-mp-p" style={at(i)}>
    <circle cx={x} cy={y - 4} r="4" fill={c} />
    <path d={`M${x - 7} ${y + 9} a7 6 0 0 1 14 0 Z`} fill={c} opacity="0.8" />
  </g>
);

const PlanAdvisor: Scene = () => (
  <>
    <circle className="mk-mp-ring" cx="46" cy="42" r="22" fill="none" stroke="var(--mp-sky)" strokeWidth="1.4" />
    <circle cx="46" cy="42" r="24" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    <g transform="translate(46 42) scale(1.9) translate(-46 -42)">
      <Person x={46} y={44} c="var(--mp-blue)" i={0} />
    </g>
    {["Müşteriler", "Portföy", "Randevular"].map((t, i) => (
      <g key={t} className="mk-mp-slide" style={at(i + 1)}>
        <rect x="84" y={16 + i * 20} width="62" height="14" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
        <circle cx="93" cy={23 + i * 20} r="3" fill={["var(--mp-mint)", "var(--mp-sky)", "var(--mp-gold)"][i]} />
        <text x="100" y={25 + i * 20} fontSize="5.6" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">{t}</text>
      </g>
    ))}
  </>
);

const PlanOffice: Scene = () => (
  <>
    <g className="mk-mp-r" style={at(0)}>
      <rect x="14" y="12" width="52" height="64" rx="6" fill="var(--mp-soft-2)" stroke="var(--mp-line)" />
      {[0, 1, 2].flatMap((r) => [0, 1].map((c) => ({ r, c }))).map(({ r, c }) => (
        <rect key={`${r}${c}`} x={22 + c * 20} y={20 + r * 14} width="14" height="8" rx="2" fill="var(--mp-sky)" opacity="0.55" />
      ))}
      <rect x="32" y="62" width="16" height="14" rx="2" fill="var(--mp-gold)" />
    </g>
    <text x="74" y="22" fontSize="6.4" fontWeight="800" fill="var(--mp-ink)">Kadıköy Ofisi</text>
    {[0, 1, 2, 3, 4].map((i) => (
      <Person key={i} x={80 + i * 15} y={44} c={["var(--mp-blue)", "var(--mp-mint)", "var(--mp-sky)", "var(--mp-gold)", "var(--mp-blue)"][i]!} i={i + 1} />
    ))}
    <g className="mk-mp-r" style={at(6)}>
      <rect x="74" y="60" width="72" height="14" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      <text x="82" y="69.5" fontSize="5.4" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">Ortak portföy · ofis raporu</text>
    </g>
  </>
);

const PlanTeam: Scene = () => (
  <>
    <path className="mk-mp-d" pathLength={1} d="M80 28 V38 M28 38 H132 M28 38 V50 M80 38 V50 M132 38 V50" fill="none" stroke="var(--mp-sky)" strokeWidth="1.8" strokeLinecap="round" />
    <g className="mk-mp-p" style={at(0)}>
      <rect x="58" y="8" width="44" height="20" rx="7" fill="var(--mp-blue)" />
      <text x="80" y="21" textAnchor="middle" fontSize="6" fontWeight="800" fill="var(--mp-card)">Merkez</text>
    </g>
    {["Kadıköy", "Ataşehir", "Beşiktaş"].map((n, i) => (
      <g key={n} className="mk-mp-p" style={at(i + 2)}>
        <rect x={[8, 60, 112][i]} y="50" width="40" height="28" rx="7" fill="var(--mp-soft-2)" stroke="var(--mp-line)" />
        <text x={[28, 80, 132][i]} y="62" textAnchor="middle" fontSize="5.6" fontWeight="800" fill="var(--mp-ink)">{n}</text>
        {[0, 1, 2].map((k) => (
          <circle key={k} cx={[17, 69, 121][i]! + k * 9} cy="70" r="2.6" fill={["var(--mp-mint)", "var(--mp-sky)", "var(--mp-gold)"][k]} />
        ))}
      </g>
    ))}
  </>
);

const PlanEnterprise: Scene = () => (
  <>
    {[[28, 22], [132, 22], [28, 68], [132, 68], [80, 12], [80, 78]].map(([x, y], i) => (
      <path key={i} className="mk-mp-d" pathLength={1} d={`M80 45 L${x} ${y}`} stroke="var(--mp-line)" strokeWidth="1.4" fill="none" />
    ))}
    <circle className="mk-mp-ring" cx="80" cy="45" r="14" fill="none" stroke="var(--mp-gold)" strokeWidth="1.5" />
    <g className="mk-mp-p" style={at(0)}>
      <circle cx="80" cy="45" r="13" fill="var(--mp-soft-2)" stroke="var(--mp-gold)" strokeWidth="1.5" />
      <path d="M72 50 l2 -10 l6 6 l6 -6 l2 10 Z" fill="var(--mp-gold)" />
    </g>
    {[[28, 22], [132, 22], [28, 68], [132, 68], [80, 12], [80, 78]].map(([x, y], i) => (
      <g key={i} className="mk-mp-p" style={at(i + 2)}>
        <rect x={x! - 11} y={y! - 7} width="22" height="14" rx="5" fill="var(--mp-soft)" stroke="var(--mp-line)" />
        <rect x={x! - 6} y={y! - 2} width="12" height="3.4" rx="1.7" fill={i % 2 ? "var(--mp-sky)" : "var(--mp-mint)"} />
      </g>
    ))}
  </>
);

const Compare: Scene = () => (
  <>
    <g className="mk-mp-f">
      <rect x="86" y="6" width="34" height="78" rx="7" fill="var(--mp-blue)" opacity="0.18" stroke="var(--mp-gold)" />
    </g>
    {[0, 1, 2].map((c) => (
      <rect key={c} x={52 + c * 34} y="10" width="26" height="6" rx="3" fill="var(--mp-soft-2)" />
    ))}
    {[0, 1, 2, 3].map((r) => (
      <g key={r}>
        <rect x="12" y={26 + r * 15} width={[30, 24, 32, 22][r]} height="4" rx="2" fill="var(--mp-ink)" opacity="0.55" />
        {[0, 1, 2].map((c) => {
          const on = c >= (r > 1 ? 1 : 0) && !(c === 0 && r === 3);
          return (
            <g key={c} className="mk-mp-p" style={at(r * 3 + c)}>
              {on ? (
                <path d={`M${60 + c * 34} ${28 + r * 15} l3 3 l6 -6`} fill="none" stroke="var(--mp-mint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <rect x={61 + c * 34} y={27 + r * 15} width="8" height="2.4" rx="1.2" fill="var(--mp-line)" />
              )}
            </g>
          );
        })}
      </g>
    ))}
  </>
);

const Calc: Scene = () => (
  <>
    {[["Aylık ilan", 62], ["Kapanış oranı", 40], ["Ort. komisyon", 78]].map(([t, w], i) => (
      <g key={t as string} transform={`translate(14 ${10 + i * 15})`}>
        <text y="5" fontSize="5.4" fontWeight="700" fill="var(--mp-ink)" opacity="0.8">{t}</text>
        <rect x="62" y="1" width="52" height="4" rx="2" fill="var(--mp-soft-2)" />
        <rect className="mk-mp-x" style={at(i)} x="62" y="1" width={(w as number) * 0.66} height="4" rx="2" fill="var(--mp-blue)" />
      </g>
    ))}
    <path d="M14 56 H146" stroke="var(--mp-line)" strokeDasharray="2 3" />
    <g className="mk-mp-r" style={at(4)}>
      <rect x="14" y="61" width="132" height="14" rx="7" fill="var(--mp-soft-2)" stroke="var(--mp-danger)" />
      <text x="24" y="70.4" fontSize="6" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">Yıllık kaçabilecek komisyon</text>
    </g>
    <circle className="mk-mp-p" style={at(3)} cx="130" cy="28" r="9" fill="var(--mp-gold)" />
    <text x="130" y="31.4" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--mp-card)">₺</text>
  </>
);

const Billing: Scene = () => (
  <>
    <g className="mk-mp-r" style={at(0)}>
      <rect x="14" y="6" width="62" height="68" rx="7" fill="var(--mp-soft)" stroke="var(--mp-line)" />
      <rect x="22" y="16" width="30" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="22" y={28 + i * 9} width={[34, 28, 36][i]} height="3" rx="1.5" fill="var(--mp-line)" />
          <rect x="60" y={28 + i * 9} width="8" height="3" rx="1.5" fill="var(--mp-ink)" opacity="0.5" />
        </g>
      ))}
      <path d="M22 54 H68" stroke="var(--mp-line)" />
      <text x="22" y="64" fontSize="5.2" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">KDV hariç</text>
      <circle className="mk-mp-p" style={at(4)} cx="62" cy="61" r="6" fill="var(--mp-mint)" />
      <path d="M59 61 l2 2 l4 -4.4" fill="none" stroke="var(--mp-card)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    {["Fatura nasıl kesilir?", "Limit aşılırsa?"].map((q, i) => (
      <g key={q} className="mk-mp-slide" style={at(i + 2)}>
        <rect x="84" y={14 + i * 32} width="64" height="14" rx="7" fill="var(--mp-blue)" />
        <text x="91" y={23.5 + i * 32} fontSize="5.2" fontWeight="700" fill="var(--mp-card)">{q}</text>
        <rect x="84" y={31 + i * 32} width="50" height="4" rx="2" fill="var(--mp-ink)" opacity="0.55" />
        <rect x="84" y={38 + i * 32} width="36" height="3" rx="1.5" fill="var(--mp-line)" />
      </g>
    ))}
  </>
);

const Plans: Scene = () => (
  <>
    {[0, 1, 2].map((i) => {
      const mid = i === 1;
      const x = 14 + i * 46;
      return (
        <g key={i} className="mk-mp-r" style={at(i)}>
          <rect x={x} y={mid ? 6 : 12} width="40" height={mid ? 76 : 70} rx="8" fill={mid ? "var(--mp-soft-2)" : "var(--mp-soft)"} stroke={mid ? "var(--mp-gold)" : "var(--mp-line)"} />
          {mid ? <rect x={x + 10} y="3" width="20" height="6" rx="3" fill="var(--mp-gold)" /> : null}
          <rect x={x + 8} y={mid ? 16 : 22} width="18" height="4" rx="2" fill="var(--mp-ink)" opacity="0.7" />
          <rect x={x + 8} y={mid ? 24 : 30} width="12" height="3" rx="1.5" fill="var(--mp-line)" />
          <rect className="mk-mp-b" style={at(i + 1)} x={x + 8} y={66 - (i + 1) * 10} width="24" height={(i + 1) * 10 + 8} rx="4" fill={mid ? "var(--mp-blue)" : "var(--mp-sky)"} opacity={mid ? 1 : 0.6} />
        </g>
      );
    })}
  </>
);

const Steps: Scene = () => (
  <>
    <path className="mk-mp-d" pathLength={1} d="M30 36 H80 H130" fill="none" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" />
    {[["Hesap", "Ofisinizi açın"], ["Ofis", "Bilgileri girin"], ["Ekip", "Davet edin"]].map(([t, s], i) => (
      <g key={t as string} transform={`translate(${30 + i * 50} 36)`}>
        <g className="mk-mp-p" style={at(i * 2)}>
          <circle r="12" fill={i === 2 ? "var(--mp-gold)" : "var(--mp-blue)"} />
          <text y="4.6" textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--mp-card)">{i + 1}</text>
        </g>
        <g className="mk-mp-r" style={at(i * 2 + 1)}>
          <text y="28" textAnchor="middle" fontSize="6.2" fontWeight="800" fill="var(--mp-ink)">{t}</text>
          <text y="37" textAnchor="middle" fontSize="4.8" fill="var(--mp-ink)" opacity="0.65">{s}</text>
        </g>
      </g>
    ))}
  </>
);

const Faq: Scene = () => (
  <>
    {[0, 1, 2].map((i) => (
      <g key={i} className="mk-mp-r" style={at(i)}>
        <rect x="14" y={8 + i * 25} width="132" height={i === 0 ? 33 : 17} rx="8" fill="var(--mp-soft)" stroke={i === 0 ? "var(--mp-sky)" : "var(--mp-line)"} />
        <circle cx="26" cy={17 + i * 25} r="5.5" fill={i === 0 ? "var(--mp-blue)" : "var(--mp-soft-2)"} />
        <text x="26" y={19.4 + i * 25} textAnchor="middle" fontSize="7" fontWeight="800" fill="var(--mp-ink)">?</text>
        <rect x="38" y={14.5 + i * 25} width={[70, 56, 64][i]} height="4.4" rx="2.2" fill="var(--mp-ink)" opacity="0.7" />
        {i === 0 ? (
          <>
            <rect className="mk-mp-x" style={at(3)} x="38" y="26" width="92" height="3.4" rx="1.7" fill="var(--mp-line)" />
            <rect className="mk-mp-x" style={at(4)} x="38" y="33" width="66" height="3.4" rx="1.7" fill="var(--mp-line)" />
          </>
        ) : (
          <path d={`M132 ${15 + i * 25} l4 4 l4 -4`} fill="none" stroke="var(--mp-sky)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </g>
    ))}
  </>
);

const Security: Scene = () => (
  <>
    <path className="mk-mp-d" pathLength={1} d="M46 10 L72 20 V44 C72 62, 60 74, 46 80 C32 74, 20 62, 20 44 V20 Z" fill="var(--mp-soft)" stroke="var(--mp-sky)" strokeWidth="2" strokeLinejoin="round" />
    <g className="mk-mp-p" style={at(3)}>
      <path d="M39 42 V36 a7 7 0 0 1 14 0 V42" fill="none" stroke="var(--mp-ink)" strokeWidth="2.4" />
      <rect x="35" y="42" width="22" height="16" rx="4" fill="var(--mp-gold)" />
    </g>
    {[0, 1, 2].map((i) => (
      <g key={i} transform={`translate(86 ${18 + i * 20})`}>
        <g className="mk-mp-r" style={at(i)}>
          <rect width="60" height="14" rx="7" fill="var(--mp-soft)" />
          <rect x="8" y="5" width={[26, 20, 30][i]} height="4" rx="2" fill="var(--mp-ink)" opacity="0.6" />
          <rect x="42" y="3" width="14" height="8" rx="4" fill={i === 2 ? "var(--mp-line)" : "var(--mp-mint)"} />
          <circle cx={i === 2 ? 46 : 52} cy="7" r="3" fill="var(--mp-card)" />
        </g>
      </g>
    ))}
  </>
);

const Consent: Scene = () => (
  <>
    <rect x="20" y="6" width="44" height="78" rx="9" fill="var(--mp-soft)" stroke="var(--mp-sky)" strokeWidth="1.5" />
    <rect x="35" y="10" width="14" height="3" rx="1.5" fill="var(--mp-line)" />
    <g className="mk-mp-r" style={at(0)}>
      <rect x="25" y="24" width="34" height="12" rx="6" fill="var(--mp-soft-2)" />
      <text x="29" y="32.4" fontSize="5.6" fontWeight="800" fill="var(--mp-ink)">+90 5••</text>
    </g>
    <g className="mk-mp-r" style={at(1)}>
      <rect x="25" y="42" width="34" height="3" rx="1.5" fill="var(--mp-line)" />
      <rect x="25" y="48" width="26" height="3" rx="1.5" fill="var(--mp-line)" />
    </g>
    <path className="mk-mp-d" pathLength={1} d="M64 45 H88" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" fill="none" />
    <g className="mk-mp-p" style={at(3)}>
      <path d="M118 14 L144 24 V46 C144 62, 132 72, 118 78 C104 72, 92 62, 92 46 V24 Z" fill="var(--mp-soft-2)" stroke="var(--mp-mint)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M107 46 l8 8 l14 -15" fill="none" stroke="var(--mp-mint)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <text className="mk-mp-f" x="118" y="12" textAnchor="middle" fontSize="5.2" fontWeight="800" fill="var(--mp-ink)" opacity="0.8">İzinli iletişim</text>
  </>
);

const Legal: Scene = () => (
  <>
    <rect x="34" y="6" width="84" height="78" rx="8" fill="var(--mp-soft)" stroke="var(--mp-line)" />
    <text x="44" y="19" fontSize="6" fontWeight="800" fill="var(--mp-ink)">KVKK Aydınlatma Metni</text>
    {[0, 1, 2, 3, 4].map((i) => (
      <rect key={i} className="mk-mp-x" style={at(i)} x="44" y={26 + i * 9} width={[64, 58, 62, 50, 40][i]} height="3.4" rx="1.7" fill="var(--mp-line)" />
    ))}
    <g className="mk-mp-p" style={at(6)}>
      <circle cx="104" cy="68" r="12" fill="var(--mp-soft-2)" stroke="var(--mp-gold)" strokeWidth="1.6" />
      <path d="M104 61 L110 63.5 V69 C110 73, 107 75, 104 76.5 C101 75, 98 73, 98 69 V63.5 Z" fill="var(--mp-gold)" />
    </g>
  </>
);

const Support: Scene = () => (
  <>
    <g className="mk-mp-r" style={at(0)}>
      <rect x="20" y="8" width="76" height="52" rx="8" fill="var(--mp-soft-2)" stroke="var(--mp-sky)" strokeWidth="1.5" />
      <path className="mk-mp-d" pathLength={1} d="M22 12 L58 38 L94 12" fill="none" stroke="var(--mp-sky)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <text className="mk-mp-f" x="58" y="72" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="var(--mp-ink)" opacity="0.85">destek@emlaksoft.com.tr</text>
    <g className="mk-mp-p" style={at(3)}>
      <path d="M108 24 h34 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-20 l-8 7 v-7 h-6 a8 8 0 0 1 -8 -8 v-14 a8 8 0 0 1 8 -8 Z" fill="var(--mp-blue)" />
      <circle cx="118" cy="39" r="2.2" fill="var(--mp-card)" />
      <circle cx="126" cy="39" r="2.2" fill="var(--mp-card)" />
      <circle cx="134" cy="39" r="2.2" fill="var(--mp-card)" />
    </g>
    <circle className="mk-mp-ring" cx="146" cy="24" r="6" fill="none" stroke="var(--mp-gold)" strokeWidth="1.4" />
    <circle cx="146" cy="24" r="3.2" fill="var(--mp-gold)" />
  </>
);

const SCENES: Record<SceneKind, Scene> = {
  dashboard: Dashboard, commission: Commission, leak: Leak, valuation: Valuation, parcel: Parcel, signature: Signature,
  automation: Automation, assistant: Assistant, showcase: Showcase, listing: Listing, tv: Tv, modules: Modules,
  setup: Setup, "plan-advisor": PlanAdvisor, "plan-office": PlanOffice, "plan-team": PlanTeam, "plan-enterprise": PlanEnterprise,
  compare: Compare, why: Why, plans: Plans, calc: Calc, billing: Billing, steps: Steps, faq: Faq, security: Security,
  consent: Consent, legal: Legal, support: Support,
};

/** Tek önizleme sahnesi: `label` kart altında küçük alt yazıdır (hangi öğenin önizlendiği). */
export function FeaturedPreview({ kind, label }: { kind: SceneKind; label?: string }) {
  const Body = SCENES[kind];
  return (
    <span className="mk-prev" data-kind={kind} aria-hidden="true">
      <svg viewBox="0 0 160 90" focusable="false">
        <Body />
      </svg>
      {label ? <span className="mk-prev-cap">{label}</span> : null}
    </span>
  );
}
