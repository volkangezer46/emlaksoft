import type { CSSProperties } from "react";

type Props = {
  data: number[];
  stroke?: string;
  fill?: string;
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
};

/** Hafif SVG sparkline — bağımlılık yok. */
export function Sparkline({
  data,
  stroke = "var(--brand-500)",
  fill = "rgba(47,120,255,0.14)",
  width = 120,
  height = 36,
  className,
  strokeWidth = 2,
}: Props) {
  const pts = data.length > 1 ? data : [0, ...data];
  const max = Math.max(1, ...pts);
  const min = Math.min(0, ...pts);
  const range = max - min || 1;
  const stepX = width / (pts.length - 1);
  const coords = pts.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * (height - 4) - 2,
  }));
  const line = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const last = coords[coords.length - 1]!;
  const len = width * 1.6;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
    >
      <polygon points={area} fill={fill} />
      <polyline
        className="chart-draw"
        style={{ "--len": len } as CSSProperties}
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2.6} fill={stroke} />
    </svg>
  );
}
