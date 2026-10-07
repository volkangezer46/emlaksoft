import type { ReactNode } from "react";

/**
 * Liste sayfası hero sahneleri (`ListHero` sağı): konuya uygun, hafif, saf SVG küçük sahneler
 * (müşteri kartları, ev + anahtar, takvim, el sıkışma, sözleşme, cüzdan, megafon, ekip …).
 * - Renk YALNIZ token: yüzey (`--surface-raised`), saç teli kenar, vurgu (`--accent`) karışımları,
 *   kontrollü altın (`--gold-*`), olumlu yeşil (`--viz-pos`) → açık ve koyu temada kendiliğinden uyar.
 * - Derinlik: zemin gölgesi + açık/koyu yüz (izometrik his), filtre/degrade YOK (maliyet).
 * - Dekoratif: aria-hidden; hareket yalnız motion.css `.ill-float` / `.ill-pulse` (reduce'ta durağan).
 * - Boyut: her sahne < 6 KB (test `illustrations.test.ts`); sunucu bileşeni, istemci JS yok.
 */

const CARD = "var(--surface-raised)";
const EDGE = "var(--hairline-strong)";
const A1 = "color-mix(in srgb, var(--accent) 12%, var(--surface-raised))";
const A2 = "color-mix(in srgb, var(--accent) 30%, var(--surface-raised))";
const A3 = "color-mix(in srgb, var(--accent) 62%, var(--surface-raised))";
const AC = "var(--accent)";
const G1 = "color-mix(in srgb, var(--gold-300) 45%, var(--surface-raised))";
const G = "var(--gold-400)";
const G2 = "var(--gold-500)";
const OK = "var(--viz-pos)";
const LEAF = "color-mix(in srgb, var(--viz-pos) 55%, var(--surface-raised))";
const LEAF2 = "color-mix(in srgb, var(--viz-pos) 80%, var(--surface-raised))";
const LN = "color-mix(in srgb, var(--accent) 22%, var(--surface-raised))";

/** Zemin gölgesi + iki yaprak öbeği (ortak dekor). */
function Ground({ cx = 128, rx = 92 }: { cx?: number; rx?: number }) {
  return <ellipse cx={cx} cy={110} rx={rx} ry={7} fill="currentColor" opacity={0.08} />;
}

function Plant({ x, s = 1 }: { x: number; s?: number }) {
  return (
    <g transform={`translate(${x} 110) scale(${s})`}>
      <path d="M0 0c-2-10-12-14-16-24 9 1 15 8 16 18 1-12 6-22 15-28-1 12-6 22-13 30" fill={LEAF} />
      <path d="M1 0c1-9 7-16 14-18-2 8-7 14-13 18" fill={LEAF2} />
      <rect x={-7} y={-2} width={15} height={8} rx={2} fill={A2} />
    </g>
  );
}

function Spark({ x, y, c = G }: { x: number; y: number; c?: string }) {
  return <path d={`M${x} ${y - 6}l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z`} fill={c} className="ill-pulse" />;
}

/** Sayfa satırı (çizgi) */
const L = (x: number, y: number, w: number, c = LN) => <rect x={x} y={y} width={w} height={4} rx={2} fill={c} />;

const SCENES = {
  musteri: (
    <>
      <Ground />
      <Plant x={52} />
      <rect x={96} y={22} width={92} height={60} rx={10} fill={A1} stroke={EDGE} transform="rotate(-8 142 52)" />
      <rect x={86} y={30} width={96} height={64} rx={10} fill={CARD} stroke={EDGE} transform="rotate(4 134 62)" />
      <g className="ill-float">
        <rect x={78} y={40} width={104} height={64} rx={11} fill={CARD} stroke={EDGE} />
        <circle cx={104} cy={66} r={13} fill={A2} />
        <circle cx={104} cy={62} r={5} fill={AC} />
        <path d="M95 75c2-5 5-7 9-7s7 2 9 7" fill={AC} />
        {L(124, 56, 42, A2)}
        {L(124, 66, 30)}
        {L(124, 76, 36)}
        <rect x={90} y={88} width={28} height={8} rx={4} fill={G1} />
        <rect x={122} y={88} width={22} height={8} rx={4} fill={A1} />
      </g>
      <Spark x={194} y={34} />
    </>
  ),
  talep: (
    <>
      <Ground />
      <Plant x={200} s={0.9} />
      <path d="M70 104V66l34-22 34 22v38z" fill={A1} stroke={EDGE} />
      <path d="M62 70l42-30 42 30" fill="none" stroke={A3} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={96} y={78} width={16} height={26} rx={3} fill={A2} />
      <g className="ill-float">
        <circle cx={150} cy={56} r={24} fill={CARD} stroke={EDGE} strokeWidth={2} />
        <circle cx={150} cy={56} r={17} fill={A1} />
        <path d="M168 74l18 18" stroke={AC} strokeWidth={8} strokeLinecap="round" />
        <path d="M142 56l6 6 11-12" fill="none" stroke={AC} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx={58} cy={36} r={6} fill={G} className="ill-pulse" />
      <path d="M58 46v8" stroke={G2} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  portfoy: (
    <>
      <Ground />
      <Plant x={46} />
      <Plant x={196} s={0.8} />
      <path d="M78 104V62l38-24v66z" fill={A2} />
      <path d="M116 104V38l52 22v44z" fill={CARD} stroke={EDGE} />
      <path d="M72 64l44-30 58 26" fill="none" stroke={A3} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={130} y={66} width={12} height={12} rx={2} fill={A1} stroke={EDGE} />
      <rect x={150} y={70} width={12} height={12} rx={2} fill={A1} stroke={EDGE} />
      <rect x={88} y={70} width={10} height={12} rx={2} fill={A1} />
      <path d="M134 104V88a6 6 0 0 1 12 0v16z" fill={A3} />
      <g className="ill-float">
        <circle cx={186} cy={34} r={10} fill="none" stroke={G} strokeWidth={5} />
        <path d="M193 41l16 16M203 51l5-5M207 55l4-4" stroke={G} strokeWidth={5} strokeLinecap="round" />
      </g>
    </>
  ),
  havuz: (
    <>
      <Ground />
      <path d="M60 80h84l-8 26H68z" fill={A2} />
      <rect x={70} y={56} width={64} height={30} rx={6} fill={CARD} stroke={EDGE} />
      <rect x={66} y={46} width={72} height={30} rx={6} fill={CARD} stroke={EDGE} />
      <g className="ill-float">
        <rect x={62} y={34} width={80} height={32} rx={7} fill={CARD} stroke={EDGE} />
        <rect x={68} y={40} width={22} height={20} rx={4} fill={A2} />
        <path d="M72 54l7-8 7 8" fill="none" stroke={AC} strokeWidth={2.5} strokeLinejoin="round" />
        {L(96, 43, 38, A2)}
        {L(96, 52, 26)}
      </g>
      <path d="M150 62h22" stroke={G} strokeWidth={4} strokeLinecap="round" strokeDasharray="2 8" className="ill-pulse" />
      <circle cx={190} cy={50} r={9} fill={A3} />
      <path d="M176 76c2-9 8-13 14-13s12 4 14 13" fill={A3} />
      <circle cx={208} cy={82} r={6} fill={A2} />
      <path d="M198 100c1-6 5-9 10-9s9 3 10 9" fill={A2} />
    </>
  ),
  randevu: (
    <>
      <Ground />
      <Plant x={44} s={0.9} />
      <rect x={70} y={24} width={104} height={82} rx={12} fill={CARD} stroke={EDGE} />
      <path d="M70 36a12 12 0 0 1 12-12h80a12 12 0 0 1 12 12v8H70z" fill={A3} />
      <rect x={90} y={16} width={6} height={16} rx={3} fill={A2} />
      <rect x={148} y={16} width={6} height={16} rx={3} fill={A2} />
      {[0, 1, 2, 3, 4].map((c) =>
        [0, 1, 2].map((r) => (
          <rect key={`${c}-${r}`} x={82 + c * 17} y={54 + r * 16} width={11} height={9} rx={2.5} fill={c === 3 && r === 1 ? G : A1} />
        )),
      )}
      <g className="ill-float">
        <circle cx={182} cy={84} r={20} fill={CARD} stroke={EDGE} strokeWidth={2} />
        <circle cx={182} cy={84} r={14} fill={A1} />
        <path d="M182 75v10l7 4" fill="none" stroke={AC} strokeWidth={3.5} strokeLinecap="round" />
      </g>
    </>
  ),
  gorev: (
    <>
      <Ground />
      <Plant x={190} />
      <rect x={76} y={24} width={84} height={84} rx={10} fill={A2} />
      <rect x={82} y={30} width={72} height={74} rx={7} fill={CARD} stroke={EDGE} />
      <rect x={102} y={18} width={32} height={14} rx={5} fill={A3} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={92} y={44 + i * 18} width={11} height={11} rx={3} fill={i < 2 ? OK : A1} />
          {i < 2 ? <path d={`M94.5 ${49.5 + i * 18}l2.5 2.5 4-5`} fill="none" stroke={CARD} strokeWidth={2} strokeLinecap="round" /> : null}
          {L(110, 47 + i * 18, i === 1 ? 26 : 36, i < 2 ? A1 : A2)}
        </g>
      ))}
      <g className="ill-float">
        <path d="M166 40l-20 44-4 10 9-7 20-44z" fill={G} />
        <path d="M166 40l5 3" stroke={G2} strokeWidth={4} strokeLinecap="round" />
      </g>
    </>
  ),
  anlasma: (
    <>
      <Ground />
      <rect x={92} y={18} width={60} height={50} rx={7} fill={CARD} stroke={EDGE} transform="rotate(-6 122 43)" />
      {L(102, 30, 34, A2)}
      {L(102, 40, 24)}
      <circle cx={140} cy={56} r={8} fill={G} className="ill-pulse" />
      <path d="M40 100L88 82" stroke={A3} strokeWidth={20} strokeLinecap="round" />
      <path d="M204 100L158 82" stroke={A2} strokeWidth={20} strokeLinecap="round" />
      <path d="M84 72l10 22M162 72l-10 22" stroke={CARD} strokeWidth={4} strokeLinecap="round" />
      <g className="ill-float">
        <path d="M92 74c9-7 19-10 29-8l17 6c6 2 5 10-1 10l-13-2" fill={A1} stroke={EDGE} strokeWidth={1.5} />
        <path d="M156 74c-9-7-20-10-30-7l-22 10c-6 3-3 11 3 10l12-3 6 7c3 3 7 3 10 0l5-4 5 5c3 3 8 2 10-1l4-7z" fill={CARD} stroke={EDGE} strokeWidth={1.5} />
        <path d="M121 86l5 5M131 84l5 5" stroke={A2} strokeWidth={2} strokeLinecap="round" />
      </g>
      <Spark x={64} y={40} />
      <Spark x={184} y={34} c={A3} />
    </>
  ),
  teklif: (
    <>
      <Ground />
      <Plant x={50} s={0.85} />
      <rect x={78} y={50} width={88} height={56} rx={8} fill={A2} />
      <rect x={88} y={30} width={68} height={52} rx={6} fill={CARD} stroke={EDGE} />
      {L(98, 40, 40, A2)}
      {L(98, 50, 30)}
      {L(98, 60, 44)}
      <path d="M78 58l44 28 44-28v40a8 8 0 0 1-8 8H86a8 8 0 0 1-8-8z" fill={A1} stroke={EDGE} />
      <g className="ill-float">
        <path d="M176 30h22l12 12-22 22-22-22v-2z" fill={G} />
        <circle cx={193} cy={38} r={3.5} fill={CARD} />
        <path d="M178 46l10 10" stroke={G2} strokeWidth={3} strokeLinecap="round" />
      </g>
    </>
  ),
  sozlesme: (
    <>
      <Ground />
      <Plant x={192} s={0.85} />
      <path d="M80 18h60l20 20v68H80z" fill={CARD} stroke={EDGE} />
      <path d="M140 18v20h20" fill={A1} stroke={EDGE} />
      {L(92, 36, 36, A2)}
      {L(92, 48, 52)}
      {L(92, 58, 44)}
      {L(92, 68, 50)}
      <path d="M92 90c6-10 9-10 11-2s6 2 12-1 6 4 10 2" fill="none" stroke={AC} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={150} cy={92} r={11} fill={G} />
      <circle cx={150} cy={92} r={6} fill="none" stroke={G2} strokeWidth={2} />
      <g className="ill-float">
        <path d="M176 36l10 10-36 36-13 3 3-13z" fill={A3} />
        <path d="M176 36l10 10 4-4-10-10z" fill={G} />
      </g>
    </>
  ),
  komisyon: (
    <>
      <Ground />
      <Plant x={48} s={0.85} />
      <rect x={72} y={44} width={96} height={62} rx={12} fill={A3} />
      <rect x={72} y={36} width={90} height={20} rx={8} fill={A2} />
      <rect x={132} y={64} width={42} height={24} rx={8} fill={A2} />
      <circle cx={146} cy={76} r={5} fill={G} />
      <g className="ill-float">
        <ellipse cx={194} cy={96} rx={16} ry={5} fill={G2} />
        <rect x={178} y={84} width={32} height={12} fill={G} />
        <ellipse cx={194} cy={84} rx={16} ry={5} fill={G1} />
        <rect x={178} y={72} width={32} height={12} fill={G} />
        <ellipse cx={194} cy={72} rx={16} ry={5} fill={G1} />
      </g>
      <path d="M92 30l18-12 14 8 22-16" fill="none" stroke={OK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M140 10h7v7" fill="none" stroke={OK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  onay: (
    <>
      <Ground />
      <Plant x={56} />
      <rect x={136} y={34} width={58} height={70} rx={7} fill={CARD} stroke={EDGE} />
      {L(146, 46, 30, A2)}
      {L(146, 56, 38)}
      {L(146, 66, 24)}
      <rect x={146} y={82} width={30} height={10} rx={5} fill={G1} />
      <g className="ill-float">
        <path d="M110 16l32 12v24c0 22-14 36-32 44-18-8-32-22-32-44V28z" fill={A3} />
        <path d="M110 24l24 9v19c0 17-10 28-24 35z" fill={AC} opacity={0.35} />
        <path d="M96 56l10 10 19-20" fill="none" stroke={CARD} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </>
  ),
  kiralama: (
    <>
      <Ground />
      <Plant x={44} s={0.9} />
      <path d="M70 106V40l30-14v80z" fill={A2} />
      <path d="M100 106V26l48 16v64z" fill={CARD} stroke={EDGE} />
      {[0, 1, 2, 3].map((r) => (
        <g key={r}>
          <rect x={110} y={44 + r * 14} width={10} height={8} rx={1.5} fill={A1} stroke={EDGE} />
          <rect x={128} y={48 + r * 14} width={10} height={8} rx={1.5} fill={r === 1 ? G1 : A1} stroke={EDGE} />
        </g>
      ))}
      <rect x={160} y={56} width={50} height={46} rx={8} fill={CARD} stroke={EDGE} />
      <path d="M160 64a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8v6h-50z" fill={A3} />
      <rect x={172} y={78} width={9} height={8} rx={2} fill={A1} />
      <rect x={186} y={78} width={9} height={8} rx={2} fill={G} />
      <g className="ill-float">
        <circle cx={176} cy={30} r={8} fill="none" stroke={G} strokeWidth={4} />
        <path d="M182 35l14 12M190 42l4-4" stroke={G} strokeWidth={4} strokeLinecap="round" />
      </g>
    </>
  ),
  aidat: (
    <>
      <Ground />
      <path d="M62 106V36h56v70z" fill={A2} />
      <path d="M62 36l28-14 28 14" fill={A3} />
      {[0, 1, 2, 3].map((r) => (
        <g key={r}>
          <rect x={72} y={46 + r * 14} width={12} height={8} rx={1.5} fill={A1} />
          <rect x={96} y={46 + r * 14} width={12} height={8} rx={1.5} fill={A1} />
        </g>
      ))}
      <g className="ill-float">
        <path d="M132 28h52v76l-6-4-7 4-6-4-7 4-6-4-7 4-6-4-7 4z" fill={CARD} stroke={EDGE} />
        {L(142, 40, 32, A2)}
        {L(142, 50, 24)}
        {L(142, 60, 28)}
        <rect x={142} y={74} width={32} height={8} rx={4} fill={OK} opacity={0.75} />
      </g>
      <circle cx={196} cy={86} r={12} fill={G} />
      <circle cx={196} cy={86} r={7} fill="none" stroke={G2} strokeWidth={2} />
    </>
  ),
  gider: (
    <>
      <Ground />
      <Plant x={200} s={0.85} />
      <g className="ill-float">
        <path d="M82 18h58v84l-6-4-7 4-6-4-7 4-6-4-7 4-6-4-7 4-6-4z" fill={CARD} stroke={EDGE} />
        {L(92, 30, 30, A2)}
        {L(92, 42, 38)}
        {L(92, 52, 26)}
        {L(92, 62, 34)}
        <rect x={92} y={76} width={38} height={8} rx={4} fill={A3} />
      </g>
      <ellipse cx={162} cy={100} rx={18} ry={5} fill={G2} />
      <rect x={144} y={88} width={36} height={12} fill={G} />
      <ellipse cx={162} cy={88} rx={18} ry={5} fill={G1} />
      <path d="M58 40v34M50 66l8 8 8-8" fill="none" stroke={A3} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" className="ill-pulse" />
    </>
  ),
  kampanya: (
    <>
      <Ground />
      <Plant x={52} s={0.85} />
      <g className="ill-float">
        <path d="M86 58l56-28v68L86 74z" fill={A3} />
        <rect x={72} y={56} width={18} height={20} rx={5} fill={A2} />
        <path d="M92 76l8 24h12l-6-22" fill={A2} />
        <ellipse cx={142} cy={64} rx={8} ry={34} fill={CARD} stroke={EDGE} />
      </g>
      <path d="M162 48c6 4 9 10 9 16s-3 12-9 16" fill="none" stroke={G} strokeWidth={4} strokeLinecap="round" className="ill-pulse" />
      <path d="M174 38c10 7 15 16 15 26s-5 19-15 26" fill="none" stroke={G} strokeWidth={4} strokeLinecap="round" opacity={0.6} />
      <rect x={180} y={14} width={34} height={20} rx={6} fill={CARD} stroke={EDGE} />
      {L(186, 22, 20, A2)}
    </>
  ),
  otomasyon: (
    <>
      <Ground />
      <path d="M86 56h30M134 56c14 0 14-24 28-24M134 56c14 0 14 26 28 26" fill="none" stroke={A2} strokeWidth={3} strokeDasharray="4 5" />
      <rect x={56} y={40} width={34} height={32} rx={9} fill={CARD} stroke={EDGE} />
      <path d="M66 56h14M73 49v14" stroke={AC} strokeWidth={3.5} strokeLinecap="round" />
      <rect x={160} y={18} width={44} height={28} rx={8} fill={CARD} stroke={EDGE} />
      {L(168, 26, 26, A2)}
      {L(168, 35, 18)}
      <rect x={160} y={68} width={44} height={28} rx={8} fill={CARD} stroke={EDGE} />
      <circle cx={172} cy={82} r={5} fill={OK} />
      {L(181, 80, 16)}
      <g className="ill-float">
        <circle cx={125} cy={56} r={18} fill={A3} />
        <circle cx={125} cy={56} r={18} fill="none" stroke={AC} strokeWidth={6} strokeDasharray="5 4.4" />
        <circle cx={125} cy={56} r={7} fill={CARD} />
      </g>
      <Spark x={110} y={24} />
    </>
  ),
  ekip: (
    <>
      <Ground />
      <Plant x={40} s={0.8} />
      <Plant x={212} s={0.8} />
      <circle cx={82} cy={54} r={13} fill={A2} />
      <path d="M58 104c2-20 12-30 24-30s22 10 24 30z" fill={A2} />
      <circle cx={174} cy={54} r={13} fill={A2} />
      <path d="M150 104c2-20 12-30 24-30s22 10 24 30z" fill={A2} />
      <g className="ill-float">
        <circle cx={128} cy={42} r={17} fill={A3} />
        <path d="M96 106c2-26 16-38 32-38s30 12 32 38z" fill={AC} />
        <path d="M120 70l8 12 8-12" fill={G} />
      </g>
      <Spark x={162} y={24} />
    </>
  ),
  belge: (
    <>
      <Ground />
      <Plant x={200} s={0.85} />
      <path d="M66 40a8 8 0 0 1 8-8h26l8 8h56a8 8 0 0 1 8 8v52a8 8 0 0 1-8 8H74a8 8 0 0 1-8-8z" fill={A3} />
      <rect x={84} y={22} width={60} height={56} rx={5} fill={CARD} stroke={EDGE} transform="rotate(-7 114 50)" />
      <rect x={96} y={26} width={60} height={56} rx={5} fill={CARD} stroke={EDGE} />
      {L(106, 36, 34, A2)}
      {L(106, 46, 40)}
      {L(106, 56, 28)}
      <path d="M62 60h116l-8 44a6 6 0 0 1-6 4H74a6 6 0 0 1-6-4z" fill={A2} />
      <g className="ill-float">
        <rect x={146} y={70} width={22} height={18} rx={4} fill={G} />
        <path d="M150 70v-5a7 7 0 0 1 14 0v5" fill="none" stroke={G2} strokeWidth={3} />
      </g>
    </>
  ),
  proje: (
    <>
      <Ground />
      <path d="M92 106V46h52v60z" fill={CARD} stroke={EDGE} />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x={102} y={56 + r * 15} width={12} height={9} rx={1.5} fill={A1} stroke={EDGE} />
          <rect x={122} y={56 + r * 15} width={12} height={9} rx={1.5} fill={r === 0 ? G1 : A1} stroke={EDGE} />
        </g>
      ))}
      <path d="M92 46h52M96 34h44" stroke={A2} strokeWidth={3} strokeDasharray="6 4" />
      <path d="M60 106V20" stroke={A3} strokeWidth={6} />
      <path d="M60 20h104" stroke={A3} strokeWidth={5} />
      <path d="M60 20l12-10h70" fill="none" stroke={A2} strokeWidth={3} />
      <g className="ill-float">
        <path d="M150 20v18" stroke={EDGE} strokeWidth={2} />
        <rect x={142} y={38} width={16} height={10} rx={2} fill={G} />
      </g>
      <Plant x={190} s={0.9} />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type HeroSceneKind = keyof typeof SCENES;
export const HERO_SCENE_KINDS = Object.keys(SCENES) as HeroSceneKind[];

export function HeroScene({ kind, className }: { kind: HeroSceneKind; className?: string }) {
  return (
    <svg viewBox="0 0 240 120" fill="none" aria-hidden="true" focusable="false" className={`ill ${className ?? ""}`}>
      {SCENES[kind]}
    </svg>
  );
}
