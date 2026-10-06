import { computeHealthScore, freshnessValue, priceConsistencyValue, type HealthInputs, type HealthResult } from "./health-score";
import { computeRiskScore, type RiskResult } from "./risk-score";
import { authorityDaysLeft, evaluateAnomalyRules, priceDeviation, type DesiredAnomaly, type PropertySnapshot } from "./anomaly-rules";
import { deriveKpiFlags, type KpiFlags } from "./kpi";
import { isMissingState } from "./check-state-machine";
import { isCheckStale } from "./cadence";
import type { ListingControlConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import type { ExitKind, LifecycleStage } from "./types";

/**
 * Portföy değerlendirme ÇEKİRDEĞİ (SAF): anlık görüntü → anomali kümesi + sağlık + risk + KPI bayrakları.
 * Sunucu tarafı (`server/sync.ts`) bunu çağırır, sonucu `lc_sync_anomalies` + `property_control_state` upsert ile yazar.
 */

export type EvaluationExtras = {
  /** photo-quality skoru 0-100 (ölçülemediyse null). */
  photoScore: number | null;
  /** properties.updated_at'ten bu yana gün (bilinmiyorsa null). */
  daysSinceUpdate: number | null;
  advisorActive: boolean | null;
  ownerInfoPresent: boolean | null;
  authorityDocPresent: boolean | null;
  /** Kayıp anomalisi ilk görüldüğünden beri açıklamasız saat (yoksa 0). */
  hoursUnexplained: number;
  exitKind: ExitKind | null;
};

export type PropertyEvaluation = {
  stage: LifecycleStage;
  exitKind: ExitKind | null;
  anomalies: DesiredAnomaly[];
  health: HealthResult;
  risk: RiskResult;
  kpi: KpiFlags;
  portalsLive: number;
  /** En kötü ilan durumuna göre portföy kontrol durumu (RPC/UI özeti). */
  worstState: PropertySnapshot["listings"][number]["state"] | null;
};

const STATE_RANK = {
  confirmed_missing: 6,
  probable_missing: 5,
  suspect: 4,
  unverifiable: 3,
  unchecked: 2,
  paused: 1,
  verified: 0,
} as const;

export function evaluateProperty(
  snap: PropertySnapshot,
  extras: EvaluationExtras,
  nowMs: number,
  cfg: ListingControlConfig = DEFAULT_LISTING_CONTROL_CONFIG,
): PropertyEvaluation {
  const anomalies = evaluateAnomalyRules(snap, nowMs, cfg);

  const worst = snap.listings.reduce<PropertySnapshot["listings"][number] | null>(
    (acc, l) => (acc === null || STATE_RANK[l.state] > STATE_RANK[acc.state] ? l : acc),
    null,
  );
  const dev = priceDeviation(snap);
  const left = authorityDaysLeft(snap.authorizationEnd, nowMs);

  const risk = computeRiskScore(
    {
      checkState: worst?.state ?? "unchecked",
      hasCrmClosure: snap.hasCrmClosure,
      explained: snap.explainedKeys.some((k) => k.startsWith("portal_missing:")),
      hoursUnexplained: extras.hoursUnexplained,
      priceDeviationRatio: dev,
      authorityDaysLeft: left,
    },
    cfg,
  );

  const anyVerified = snap.listings.some((l) => l.state === "verified");
  const anyMissing = snap.listings.some((l) => isMissingState(l.state));
  const measurable = snap.listings.some((l) => l.state !== "unchecked" && l.state !== "unverifiable" && l.state !== "paused");
  const portalPrices = snap.listings.map((l) => l.portalPrice).filter((p): p is number => typeof p === "number" && p > 0);
  const idUrlOk =
    snap.listings.length === 0
      ? null
      : snap.listings.filter((l) => !!l.externalId && !!l.url && /^https?:\/\//i.test(l.url)).length / snap.listings.length;
  const recency =
    snap.listings.length === 0
      ? null
      : snap.listings.filter((l) => !isCheckStale(l.lastSuccessAt, nowMs, cfg.cadence)).length / snap.listings.length;

  const healthInputs: HealthInputs = {
    onPortal: anyVerified && !anyMissing ? 1 : anyMissing ? 0 : snap.listings.length === 0 ? 0 : measurable ? 0.5 : null,
    price: priceConsistencyValue(snap.listPrice, portalPrices, cfg.price.toleranceRatio, cfg.price.criticalRatio),
    advisor: snap.assignedTo ? (extras.advisorActive === false ? 0 : 1) : 0,
    authority: left === null ? null : left < 0 ? 0 : left <= cfg.authority.urgentDays ? 0.5 : 1,
    photos: extras.photoScore === null ? null : extras.photoScore / 100,
    freshness: freshnessValue(extras.daysSinceUpdate),
    idUrlValid: idUrlOk,
    contact: extras.ownerInfoPresent === null ? null : extras.ownerInfoPresent ? 1 : 0,
    eids: extras.authorityDocPresent === null ? null : extras.authorityDocPresent ? 1 : 0,
    checkRecency: recency,
  };
  const health = computeHealthScore(healthInputs, cfg.healthWeights, cfg.healthColors);

  const kpi = deriveKpiFlags(
    {
      active: snap.active,
      stage: snap.stage,
      listings: snap.listings,
      anomalies,
      explainedKeys: snap.explainedKeys,
      healthScore: health.score,
      healthyMinScore: cfg.healthyMinScore,
    },
    nowMs,
    cfg.cadence,
  );

  return {
    stage: snap.stage,
    exitKind: extras.exitKind,
    anomalies,
    health,
    risk,
    kpi,
    portalsLive: snap.listings.filter((l) => !isMissingState(l.state)).length,
    worstState: worst?.state ?? null,
  };
}
