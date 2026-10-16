import type { ReactNode } from "react";

/**
 * Portföy & vitrin alanının hero sahneleri (sahibinden, değerleme, bölge, ilan kontrol, anahtar, sunum).
 * `hero-scenes.tsx` ile aynı kurallar: yalnız token renk, filtre/degrade yok, hareket `.ill-float`/`.ill-pulse`.
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

export const PORTFOY_SCENES = {
  sahibinden: (
    <>
      <Ground />
      <Plant x={40} s={0.8} />
      <path d="M70 106V64l34-22 34 22v42z" fill={CARD} stroke={EDGE} />
      <path d="M64 68l40-28 40 28" fill="none" stroke={A3} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={82} y={74} width={12} height={12} rx={2} fill={A1} stroke={EDGE} />
      <rect x={112} y={74} width={12} height={12} rx={2} fill={A1} stroke={EDGE} />
      <path d="M98 106V92a6 6 0 0 1 12 0v14z" fill={A2} />
      <path d="M158 106V58" stroke={A3} strokeWidth={4} strokeLinecap="round" />
      <g className="ill-float">
        <rect x={146} y={40} width={50} height={26} rx={5} fill={G1} stroke={G} />
        {L(153, 47, 36, G2)}
        {L(153, 56, 24, G)}
      </g>
      <g className="ill-float">
        <rect x={192} y={70} width={24} height={38} rx={5} fill={CARD} stroke={EDGE} />
        <rect x={196} y={76} width={16} height={22} rx={2} fill={A1} />
        <path d="M200 86c2 4 5 7 9 8l2-2-3-3-2 1c-1-1-2-2-3-4l1-2-3-3z" fill={AC} />
      </g>
    </>
  ),
  degerleme: (
    <>
      <Ground />
      <Plant x={200} s={0.85} />
      <path d="M58 106V70l28-18 28 18v36z" fill={CARD} stroke={EDGE} />
      <path d="M52 74l34-24 34 24" fill="none" stroke={A3} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={72} y={80} width={10} height={10} rx={2} fill={A1} stroke={EDGE} />
      <path d="M86 106V94a5 5 0 0 1 10 0v12z" fill={A2} />
      <rect x={124} y={84} width={10} height={22} rx={2} fill={A2} />
      <rect x={140} y={72} width={10} height={34} rx={2} fill={A3} />
      <rect x={156} y={58} width={10} height={48} rx={2} fill={AC} />
      <g className="ill-float">
        <path d="M150 40a24 24 0 0 1 48 0" fill="none" stroke={A1} strokeWidth={7} strokeLinecap="round" />
        <path d="M150 40a24 24 0 0 1 38-19.4" fill="none" stroke={OK} strokeWidth={7} strokeLinecap="round" />
        <path d="M174 40l10-12" stroke={G2} strokeWidth={3} strokeLinecap="round" />
        <circle cx={174} cy={40} r={3.5} fill={G2} />
      </g>
    </>
  ),
  bolge: (
    <>
      <Ground />
      <path d="M50 96l44-14 52 12 46-16v-50l-46 16-52-12-44 14z" fill={CARD} stroke={EDGE} />
      <path d="M94 82V32M146 94V44" stroke={EDGE} />
      <path d="M50 70l44-12 52 10 46-14" fill="none" stroke={LN} strokeWidth={3} />
      <path d="M104 40l14 8 18-6" fill="none" stroke={A2} strokeWidth={4} strokeLinecap="round" />
      <circle cx={70} cy={80} r={7} fill={A1} />
      <circle cx={172} cy={66} r={9} fill={G1} />
      <g className="ill-float">
        <path d="M120 66c-12-14-18-22-18-30a18 18 0 0 1 36 0c0 8-6 16-18 30z" fill={AC} />
        <circle cx={120} cy={36} r={7} fill={CARD} />
      </g>
      <Spark x={186} y={30} />
    </>
  ),
  ilan: (
    <>
      <Ground />
      <rect x={58} y={30} width={96} height={74} rx={8} fill={CARD} stroke={EDGE} />
      <rect x={66} y={38} width={34} height={26} rx={4} fill={A2} />
      <path d="M70 60l9-10 9 10" fill="none" stroke={AC} strokeWidth={2.5} strokeLinejoin="round" />
      {L(106, 40, 40, A2)}
      {L(106, 50, 30)}
      {L(106, 58, 34)}
      {L(66, 74, 80)}
      {L(66, 84, 60)}
      <circle cx={78} cy={95} r={4} fill={OK} />
      {L(86, 93, 30, LEAF)}
      <g className="ill-float">
        <circle cx={168} cy={62} r={20} fill={A1} stroke={A3} strokeWidth={5} />
        <path d="M159 62l6 6 12-12" fill="none" stroke={OK} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M182 77l16 16" stroke={A3} strokeWidth={7} strokeLinecap="round" />
      </g>
      <Plant x={210} s={0.75} />
    </>
  ),
  anahtar: (
    <>
      <Ground />
      <rect x={60} y={24} width={120} height={80} rx={8} fill={CARD} stroke={EDGE} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx={82 + i * 26} cy={38} r={3} fill={A3} />
          <path d={`M${82 + i * 26} 41v10`} stroke={EDGE} strokeWidth={2} />
          <circle cx={82 + i * 26} cy={58} r={6} fill="none" stroke={i === 1 ? G : A2} strokeWidth={3.5} />
          <path d={`M${82 + i * 26} 64v14m0-5h4m-4 4h3`} stroke={i === 1 ? G : A2} strokeWidth={3.5} strokeLinecap="round" />
        </g>
      ))}
      {L(72, 92, 60)}
      <g className="ill-float">
        <circle cx={196} cy={50} r={10} fill="none" stroke={G} strokeWidth={5} />
        <path d="M203 57l14 14M212 66l5-5M216 70l4-4" stroke={G} strokeWidth={5} strokeLinecap="round" />
      </g>
      <Plant x={40} s={0.8} />
    </>
  ),
  sunum: (
    <>
      <Ground />
      <path d="M120 96l-26 14M120 96l26 14M120 96v14" stroke={A3} strokeWidth={4} strokeLinecap="round" />
      <rect x={66} y={24} width={108} height={72} rx={7} fill={CARD} stroke={EDGE} />
      <rect x={76} y={34} width={42} height={30} rx={4} fill={A2} />
      <path d="M80 60l10-12 10 12" fill="none" stroke={AC} strokeWidth={2.5} strokeLinejoin="round" />
      {L(124, 36, 40, A2)}
      {L(124, 46, 30)}
      {L(124, 56, 36)}
      <rect x={76} y={72} width={26} height={14} rx={3} fill={G1} />
      {L(108, 76, 54)}
      <g className="ill-float">
        <circle cx={196} cy={44} r={14} fill={A1} stroke={A3} strokeWidth={3} />
        <path d="M191 37v14l12-7z" fill={AC} />
      </g>
      <Plant x={40} s={0.85} />
    </>
  ),
} satisfies Record<string, ReactNode>;
