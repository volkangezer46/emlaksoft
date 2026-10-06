/**
 * Veri görselleştirme kiti (bkz. docs/DESIGN_SYSTEM.md "Veri görselleştirme kiti").
 * Hepsi sunucu-güvenli saf SVG/CSS (istemci JS yok, yeni bağımlılık yok). Renkler `--viz-*`
 * tokenlarından, derinlik dili (ışık/gölge/parlama) `src/app/viz.css`; hareket ilk görünümde bir kez (motion.css `.viz-*`),
 * reduced-motion'da durağan.
 */
export { AreaChart, type VizAreaSeries } from "./area-chart";
export { RadialGauge } from "./radial-gauge";
export { DonutRing, type DonutSegment } from "./donut-ring";
export { TubeGradient } from "./tube-gradient";
export { FunnelChart, type FunnelStage } from "./funnel-chart";
export { Heatmap } from "./heatmap";
export { SkeletonCard } from "./skeleton-card";
export { ChartCard } from "../chart-frame";
export { VIZ_SERIES, VIZ_SEQ, vizToneColor, formatViz, type VizFormat, type VizTone } from "./colors";
