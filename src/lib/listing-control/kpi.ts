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

/**
 * PORTALDA VARLIK — TEK TANIM (B083). İlan Kontrol, pano ve Kapanış aynı etiketleri kullanır; SQL kopyası
 * `public.property_portal_presence(registry_status, check_state)` (migration 20261016090100) aynı tabloyu verir.
 *  - yayinda_dogrulandi: kayıt (portal_listings.status) live ∧ tarayıcı son kontrolde gördü (verified)
 *  - yayinda_teyitsiz:   kayıt live ama tarayıcı görmedi/denetlemedi (unchecked, suspect, missing, unverifiable, paused)
 *  - kaldirildi:         kayıt live değil
 * "Canlı" sayısı = ilk iki durum (kayıt live); "doğrulanmış" = yalnız ilki. Eskiden İlan Kontrol tarayıcı durumunu,
 * pano/Kapanış kaydı sayıyordu: aynı ofiste "0" ve "9" yan yana görünüyordu.
 */
export type PortalPresence = "yayinda_dogrulandi" | "yayinda_teyitsiz" | "kaldirildi";

export const PORTAL_PRESENCE_LABELS: Record<PortalPresence, string> = {
  yayinda_dogrulandi: "Yayında (doğrulandı)",
  yayinda_teyitsiz: "Yayında (teyitsiz)",
  kaldirildi: "Kaldırıldı",
};

export function portalPresence(registryStatus: string | null | undefined, checkState: string | null | undefined): PortalPresence {
  if ((registryStatus ?? "").toLowerCase() !== "live") return "kaldirildi";
  return checkState === "verified" ? "yayinda_dogrulandi" : "yayinda_teyitsiz";
}

/** "X canlı (Y doğrulanmış)" — Y bilinmiyorsa yalnız X. */
export function livePresenceText(live: number, verified: number | null): string {
  return verified == null ? `${live} canlı` : `${live} canlı (${verified} doğrulanmış)`;
}

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
  // `listings` yalnız kaydı live olan portal ilanlarıdır: "portallarda" = kayıt live (doğrulanmış + teyitsiz; B083).
  // Tarayıcının göremediği kayıt ayrıca `portal_missing` bayrağıyla işaretlenir.
  const portalsLive = i.listings.length;
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
