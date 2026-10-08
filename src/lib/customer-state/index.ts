/** Müşteri durumu — tek okuyucu. Sunucu yükleyicisi (`load.ts`) ayrıdır: `@/lib/customer-state/load`. */
export * from "@/lib/customer-state/core";
export * from "@/lib/customer-state/thresholds";
export { HEAT_SEGMENTS, heatTitle, type CustomerHeat, type HeatSegment } from "@/lib/customer-state/heat";
export { leadTierCls, type LeadScore } from "@/lib/customer-state/lead";
export { isOwnerCustomer, hasListingIntent, type SellerPrediction } from "@/lib/customer-state/seller";
export type { ChurnRisk } from "@/lib/customer-state/churn";
