/**
 * Liste kiti — liste sayfalarının ortak yapı taşları. Kullanım ve API: docs/DESIGN_SYSTEM.md "Liste kiti".
 * Hepsi sunucu uyumlu; yalnız `BulkBar` (olay işleyici alır) istemci ağacında kullanılır.
 */
export { ListToolbar } from "./list-toolbar";
export { KpiStrip, type KpiItem } from "./kpi-strip";
export { CategoryChips } from "./category-chips";
export { StatusPill, TONE_CLASS as PILL_TONE_CLASS, type PillTone } from "./status-pill";
export { EntityThumb } from "./entity-thumb";
export { RowActions, RowActionLink, RowActionAnchor } from "./row-actions";
export { ViewSwitcher, type ViewOption } from "./view-switcher";
export { BulkBar } from "./bulk-bar";
export { FilterSelect, FilterGrid } from "./filter-field";
export {
  bucketByWeek,
  trendOf,
  hasSeries,
  barHeights,
  buildCategoryChips,
  buildActiveChips,
  densityOf,
  hiddenFields,
  mergeResetPage,
  WEEK_MS,
  type Trend,
  type CategoryOption,
  type CategoryChipModel,
  type ActiveChip,
  type ActiveChipDef,
  type Density,
} from "./list-logic";
