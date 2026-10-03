/**
 * Premium konsol bileşen kitaplığı (bkz. docs/DESIGN_SYSTEM.md "Premium konsol").
 * Hepsi sunucu-güvenli (istemci JS yok), saf SVG, yeni bağımlılık yok.
 */
export { HeroBanner } from "./hero-banner";
export { GlassKpi } from "./glass-kpi";
export { KpiCard, type KpiCardProps } from "./kpi-card";
export { Sparkline } from "./sparkline";
export { MiniBars } from "./mini-bars";
export { TrendPill } from "./trend-pill";
export { PeriodToggle } from "./period-toggle";
export { CityNight } from "./city-night";
export {
  PERIODS,
  PERIOD_PARAM,
  DEFAULT_PERIOD,
  barsGeometry,
  bucketCountFor,
  bucketDates,
  computeTrend,
  hasSeries,
  parsePeriod,
  periodHref,
  sparkPath,
  summarizeSeries,
  type Period,
  type PremiumTone,
  type Trend,
} from "./premium-math";
