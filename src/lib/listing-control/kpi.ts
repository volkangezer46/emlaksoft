import { isMissingState } from "./check-state-machine";
import { isCheckStale } from "./cadence";
import type { CadenceConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import { isAwaitingPublishStage } from "./lifecycle";
import type { DesiredAnomaly, ListingSnapshot } from "./anomaly-rules";
import type { KpiKey, LifecycleStage } from "./types";

/**
 * KPI bayrakları (SAF) — `property_control_state.k_*` kolonlarının TEK kaynağı. Sayı (count filter) ve liste (where)
 * AYNI kolondan okunduğu için kart sayısı = liste satırı (sıfır çıkmaz metrik). Yeni KPI = KPI_KEYS + migration kolonu
 * + `listing_control_list` CASE kolu.
 */

export type KpiFlags = Record<KpiKey, boolean>;

export type KpiInput = {
  active: boolean;
  stage: LifecycleStage;
  listings: readonly ListingSnapshot[];
  anomalies: readonly DesiredAnomaly[];
  explainedKeys: readonly string[];
  healthScore: number | null;
  healthyMinScore: number;
};

export function deriveKpiFlags(
  i: KpiInput,
  nowMs: number,
  cadence: CadenceConfig = DEFAULT_LISTING_CONTROL_CONFIG.cadence,
): KpiFlags {
  const missing = i.listings.some((l) => isMissingState(l.state));
  const portalsLive = i.listings.filter((l) => !isMissingState(l.state)).length;
  const unverifiable =
    i.listings.length > 0 &&
    !missing &&
    i.listings.some((l) => l.state === "unverifiable" || (l.state !== "unchecked" && isCheckStale(l.lastSuccessAt, nowMs, cadence)));
  const explained = new Set(i.explainedKeys);
  const inReview = i.anomalies.some((a) => a.severity !== "info" && !explained.has(a.dedupeKey));
  const significant = i.anomalies.some((a) => a.severity === "medium" || a.severity === "high" || a.severity === "critical");
  const active = i.active;
  return {
    active,
    in_portals: active && portalsLive > 0,
    awaiting_publish: active && i.listings.length === 0 && isAwaitingPublishStage(i.stage),
    portal_missing: active && missing,
    price_mismatch: active && i.anomalies.some((a) => a.type === "price_mismatch"),
    in_review: active && inReview,
    unverifiable: active && unverifiable,
    healthy: active && !missing && !significant && i.healthScore !== null && i.healthScore >= i.healthyMinScore,
  };
}
