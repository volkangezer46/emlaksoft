import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatViz, vizToneColor, type VizFormat, type VizTone } from "./colors";
import { TubeGradient } from "./tube-gradient";

/**
 * RadialGauge (viz) — halka ilerleme + hedef/ilerleme işaretçisi. `ProgressRing`,
 * premium `Ring` ve console `Ring` bunun üzerine kuruludur (eski dışa aktarımlar korunur).
 *
 * Yalnız gerçek oran: `max <= 0` ise `null` (sahte yüzde yok). Oran 0–1 arasına kırpılır;
 * taşma (ör. %120) gerçek değer olarak sr-only metinde ve çağıranın merkez içeriğinde yer alır.
 * - Yay `pathLength=1` ile çizilir; ilk görünümde bir kez süpürülür (motion.css `.viz-sweep`).
 *   `live` verilirse (canlı pano) süpürme yerine değer değişiminde akıcı geçiş (viz.css `.viz-arc-live`).
 * - Derinlik: halkanın üstünde tek "tüp" degradesi (iç kenar gölge → dış kenar ışık; `TubeGradient`) → kalınlık hissi.
 * - `target` (aynı birimde hedef değer) verilirse halka üzerinde ince bir hedef çentiği çizilir.
 * - İlerleme işareti: yayın ucunda yüzey renkli halkalı nokta (yay uzunluğu 0'dan büyükse).
 * - `fluid`: piksel boyutu yerine kapsayıcıyı doldurur (ör. TV panosu em/vw ölçeği); `size` yalnız geometri birimidir.
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
  trackColor = "var(--hairline-strong)",
  format = "number",
  ariaLabel,
  fluid = false,
  live = false,
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
  /** Ham CSS rengi (tone'u ezer). Token kullan. */
  color?: string;
  /** Yatak (boş halka) rengi; varsayılan `--hairline-strong`. */
  trackColor?: string;
  format?: VizFormat;
  ariaLabel: string;
  /** Kapsayıcıyı doldur (genişlik/yükseklik %100). */
  fluid?: boolean;
  /** Canlı değer: ilk süpürme yok, değer değişimi akıcı geçer. */
  live?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const tubeId = `viz-tube-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
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
  const box = fluid ? { width: "100%", height: "100%" } : { width: size, height: size };

  return (
    <div role="img" aria-label={text} className={cn("relative grid shrink-0 place-items-center", className)} style={box}>
      <svg width={fluid ? "100%" : size} height={fluid ? "100%" : size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90 overflow-visible">
        <defs>
          <TubeGradient id={tubeId} cx={cx} cy={cx} inner={r - stroke / 2} outer={r + stroke / 2} />
        </defs>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
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
              className={live ? "viz-arc-live" : "viz-sweep"}
              style={{ "--viz-off": off } as CSSProperties}
            />
        ) : null}
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={`url(#${tubeId})`} strokeWidth={stroke} pointerEvents="none" />
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
