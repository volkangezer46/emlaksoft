import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "./colors";

/**
 * RadialGauge (viz) — halka ilerleme + hedef/ilerleme işaretçisi. `ProgressRing`,
 * premium `Ring` ve console `Ring` bunun üzerine kuruludur (eski dışa aktarımlar korunur).
 *
 * Yalnız gerçek oran: `max <= 0` ise `null` (sahte yüzde yok). Oran 0–1 arasına kırpılır;
 * taşma (ör. %120) gerçek değer olarak sr-only metinde ve çağıranın merkez içeriğinde yer alır.
 * - Yay `pathLength=1` ile çizilir; ilk görünümde bir kez süpürülür (motion.css `.viz-sweep`).
 * - `target` (aynı birimde hedef değer) verilirse halka üzerinde ince bir hedef çentiği çizilir.
 * - İlerleme işareti: yayın ucunda yüzey renkli halkalı nokta (yay uzunluğu 0'dan büyükse).
 * - Erişilebilirlik: role="img" + sr-only değer metni; merkez içerik görsel bilgi içindir.
 */
export function RadialGauge({
  value,
  max,
  target,
  size = 96,
  stroke = 9,
  tone,
  color,
  format = "number",
  ariaLabel,
  children,
  className,
}: {
  value: number;
  max: number;
  /** Hedef değer (value/max ile aynı birim). 0 < target <= max olmalı. */
  target?: number;
  size?: number;
  stroke?: number;
  tone?: VizTone;
  /** Ham CSS rengi (tone'u ezer). */
  color?: string;
  format?: VizFormat;
  ariaLabel: string;
  children?: ReactNode;
  className?: string;
}) {
  if (!(max > 0)) return null;
  const safe = Number.isFinite(value) ? value : 0;
  const ratio = Math.min(1, Math.max(0, safe / max));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const stroke_ = color ?? vizToneColor(tone, 0);
  const off = (1.02 - ratio).toFixed(4);
  // Svg -90° döndürülüyor: yay üstten başlar; işaretçiler döndürülmüş koordinatta hesaplanır.
  const at = (f: number, rr: number) => {
    const a = f * 2 * Math.PI;
    return { x: (cx + rr * Math.cos(a)).toFixed(2), y: (cx + rr * Math.sin(a)).toFixed(2) };
  };
  const tgt = target !== undefined && target > 0 && target <= max ? target / max : null;
  const tIn = tgt !== null ? at(tgt, r - stroke / 2 - 1) : null;
  const tOut = tgt !== null ? at(tgt, r + stroke / 2 + 1) : null;
  const tip = ratio > 0 ? at(ratio, r) : null;
  const text = `${ariaLabel}: ${formatViz(safe, format)} / ${formatViz(max, format)}${
    target !== undefined ? ` (hedef ${formatViz(target, format)})` : ""
  }`;

  return (
    <div role="img" aria-label={text} className={cn("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90 overflow-visible">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--hairline-strong)" strokeWidth={stroke} />
        {ratio > 0 ? (
          <circle
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={stroke_}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1.02"
            strokeDashoffset={off}
            className="viz-sweep"
            style={{ "--viz-off": off } as CSSProperties}
          />
        ) : null}
        {tIn && tOut ? <line x1={tIn.x} y1={tIn.y} x2={tOut.x} y2={tOut.y} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" /> : null}
        {tip ? (
          <g className="viz-fade-late">
            <circle cx={tip.x} cy={tip.y} r={stroke / 2 + 1.5} fill="var(--surface)" />
            <circle cx={tip.x} cy={tip.y} r={stroke / 4} fill={stroke_} />
          </g>
        ) : null}
      </svg>
      {children ? <div className="absolute inset-0 grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}
