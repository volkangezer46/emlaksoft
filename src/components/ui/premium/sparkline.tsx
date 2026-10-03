import { useId } from "react";
import { cn } from "@/lib/utils";
import { sparkPath, summarizeSeries, type PremiumTone } from "./premium-math";

/**
 * Sparkline — saf SVG, sunucu bileşeni. GERÇEK seri verilmezse (en az 2 sonlu
 * nokta) HİÇBİR ŞEY çizmez: uydurma çizim yok. Çizgi ve uç nokta
 * `vector-effect: non-scaling-stroke` ile sabit kalınlıkta, uç nokta tam daire.
 * a11y: role="img" + aria-label özeti (varsayılan: seri min/maks/son).
 */
export function Sparkline({
  data,
  tone = "brand",
  label,
  unit,
  height = 40,
  className,
}: {
  data: readonly number[] | undefined | null;
  tone?: PremiumTone;
  /** Erişilebilir özet; verilmezse seriden üretilir. */
  label?: string;
  /** Özet cümlesindeki birim ("hafta", "ay"...). */
  unit?: string;
  height?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = 160;
  const H = 40;
  const p = sparkPath(data, { width: W, height: H, padding: 5 });
  if (!p) return null;
  return (
    <svg
      role="img"
      aria-label={label ?? summarizeSeries(data, unit)}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn(`pm-t-${tone} block w-full overflow-visible`, className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`pm-sp-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--t)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--t)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {p.flat ? null : <path d={p.area} fill={`url(#pm-sp-${uid})`} />}
      <path
        d={p.line}
        fill="none"
        stroke="var(--t)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Uç nokta: sıfır uzunluklu yol + yuvarlak uç = ölçekten etkilenmeyen daire */}
      <path
        d={`M${p.last.x},${p.last.y} l0.001,0`}
        stroke="var(--t)"
        strokeWidth="7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${p.last.x},${p.last.y} l0.001,0`}
        stroke="var(--surface-raised)"
        strokeWidth="3"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
