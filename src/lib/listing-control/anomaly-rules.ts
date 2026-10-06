import type { ListingControlConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import { tokenSimilarity } from "@/lib/duplicate-match";
import { isMissingState } from "./check-state-machine";
import type { AnomalySeverity, AnomalyType, CheckState, LifecycleStage } from "./types";

/**
 * ANOMALİ KURAL MOTORU (SAF, konfigüre edilebilir eşikler). Girdi: bir portföyün anlık görüntüsü; çıktı: o portföy için
 * ŞU AN geçerli olması gereken anomali kümesi (`DesiredAnomaly[]`). Eşitleme (aç / yeniden aç / kapanan koşulu
 * otomatik kapat) `lc_sync_anomalies` RPC'sindedir. `dedupeKey` deterministiktir: aynı olay tekrar anomali açmaz.
 *
 * Kapsam (portföy bazlı): portal_missing, not_published, price_mismatch, advisor_mismatch, potential_lost_deal,
 * sold_still_listed, incomplete_closure, authority_expiring. Ofis geneli (bulk_mismatch, unregistered_listing) ve
 * duplicate ayrı girdilerle üretilir (bkz. `bulk-mismatch.ts`, `matching.ts`).
 * Ölçülemeyen durum (bilinmeyen portal fiyatı, danışman adı...) anomali ÜRETMEZ ("ölçülemedi").
 */

export type ListingSnapshot = {
  id: string;
  portal: string;
  externalId: string | null;
  url: string | null;
  state: CheckState;
  confidence: number | null;
  portalPrice: number | null;
  portalAdvisorName: string | null;
  firstAbsentAt: string | null;
  lastSuccessAt: string | null;
  publishedAt: string | null;
};

export type ClosureSnapshot = {
  closedAt: string;
  /** Eksik kapanış maddeleri (portal kaldırıldı, işlem, fiyat, komisyon, sözleşme, tahsilat, evrak...). Boş = tamam. */
  missingItems: string[];
} | null;

export type PropertySnapshot = {
  propertyId: string;
  propertyCode: string | null;
  stage: LifecycleStage;
  active: boolean;
  /** Canlı ilan satırları (status='live'). */
  listings: ListingSnapshot[];
  listPrice: number | null;
  assignedTo: string | null;
  assignedAdvisorName: string | null;
  /** İlk danışman ataması (ISO). */
  assignedAt: string | null;
  /** Yayına hazır sayılan durumda mı (ham status: ready/live...). */
  publishable: boolean;
  /** authorization_end (ISO tarih) ya da null. */
  authorizationEnd: string | null;
  /** satış/kiralama/iptal gibi CRM kapanış kaydı. */
  hasCrmClosure: boolean;
  closure: ClosureSnapshot;
  /** Mevcut anomalilerden kodlu açıklaması girilmiş olanların dedupe anahtarları (inceleme KPI'ı için). */
  explainedKeys: readonly string[];
};

export type DesiredAnomaly = {
  type: AnomalyType;
  severity: AnomalySeverity;
  dedupeKey: string;
  portalListingId: string | null;
  details: Record<string, unknown>;
  /** SLA süresi bu zamana (ISO). Yalnız YENİ açılışta/yeniden açılışta kullanılır. */
  slaDueAt: string | null;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function authorityDaysLeft(authorizationEnd: string | null, nowMs: number): number | null {
  if (!authorizationEnd) return null;
  const t = Date.parse(authorizationEnd.length <= 10 ? `${authorizationEnd}T23:59:59+03:00` : authorizationEnd);
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - nowMs) / DAY);
}

/** max |portal − CRM| / CRM (portal fiyatı olanlar). Ölçülemiyorsa null. */
export function priceDeviation(snapshot: Pick<PropertySnapshot, "listPrice" | "listings">): number | null {
  const crm = snapshot.listPrice;
  if (!crm || crm <= 0) return null;
  const prices = snapshot.listings.map((l) => l.portalPrice).filter((p): p is number => typeof p === "number" && p > 0);
  if (prices.length === 0) return null;
  return Math.max(...prices.map((p) => Math.abs(p - crm) / crm));
}

export function evaluateAnomalyRules(
  s: PropertySnapshot,
  nowMs: number,
  cfg: ListingControlConfig = DEFAULT_LISTING_CONTROL_CONFIG,
): DesiredAnomaly[] {
  const out: DesiredAnomaly[] = [];
  const slaDue = iso(nowMs + cfg.sla.teamLeadHours * HOUR);
  const closedStage = s.stage === "sold" || s.stage === "rented" || s.stage === "exited";

  // 1) Portal ilanı kayıp (olası/onaylı). Şüpheli tek başına anomali AÇMAZ.
  if (s.active) {
    for (const l of s.listings) {
      if (!isMissingState(l.state)) continue;
      out.push({
        type: "portal_missing",
        severity: l.state === "confirmed_missing" ? "critical" : "high",
        dedupeKey: `portal_missing:${l.id}`,
        portalListingId: l.id,
        details: { portal: l.portal, externalId: l.externalId, state: l.state, confidence: l.confidence, since: l.firstAbsentAt },
        slaDueAt: slaDue,
      });
    }
  }

  // 2) Yayınlanmayan portföy: atandı + yayına hazır + canlı ilan yok, 24/48 saat.
  if (s.active && s.assignedTo && s.publishable && s.listings.length === 0 && s.assignedAt) {
    const hours = (nowMs - Date.parse(s.assignedAt)) / HOUR;
    if (hours >= cfg.unpublished.warnHours) {
      out.push({
        type: "not_published",
        severity: hours >= cfg.unpublished.criticalHours ? "critical" : "medium",
        dedupeKey: `not_published:${s.propertyId}`,
        portalListingId: null,
        details: { hoursSinceAssigned: Math.floor(hours), stage: s.stage },
        slaDueAt: slaDue,
      });
    }
  }

  // 3) Fiyat uyuşmazlığı: portal bazında yan yana.
  const dev = priceDeviation(s);
  if (s.active && dev !== null && dev > cfg.price.toleranceRatio && s.listPrice) {
    out.push({
      type: "price_mismatch",
      severity: dev >= cfg.price.criticalRatio ? "high" : "medium",
      dedupeKey: `price_mismatch:${s.propertyId}`,
      portalListingId: null,
      details: {
        crmPrice: s.listPrice,
        deviationPercent: Math.round(dev * 1000) / 10,
        portals: s.listings
          .filter((l) => typeof l.portalPrice === "number")
          .map((l) => ({
            portal: l.portal,
            portalListingId: l.id,
            price: l.portalPrice,
            deviationPercent: Math.round((Math.abs((l.portalPrice as number) - s.listPrice!) / s.listPrice!) * 1000) / 10,
          })),
      },
      slaDueAt: slaDue,
    });
  }

  // 4) Danışman uyuşmazlığı: yalnız portal danışman adı VE CRM danışman adı biliniyorsa (API/feed verisi).
  if (s.active && s.assignedAdvisorName) {
    for (const l of s.listings) {
      if (!l.portalAdvisorName || isMissingState(l.state)) continue;
      if (tokenSimilarity(l.portalAdvisorName, s.assignedAdvisorName) < 0.5) {
        out.push({
          type: "advisor_mismatch",
          severity: "low",
          dedupeKey: `advisor_mismatch:${l.id}`,
          portalListingId: l.id,
          details: { portal: l.portal, portalAdvisor: l.portalAdvisorName, crmAdvisor: s.assignedAdvisorName },
          slaDueAt: null,
        });
      }
    }
  }

  // 5) Potansiyel kayıp işlem: onaylı kayıp + CRM'de satıldı/kiralandı/iptal işlemi yok (24 saat).
  if (!closedStage && !s.hasCrmClosure) {
    const confirmed = s.listings.filter((l) => l.state === "confirmed_missing" && l.firstAbsentAt);
    if (confirmed.length > 0) {
      const since = Math.min(...confirmed.map((l) => Date.parse(l.firstAbsentAt as string)));
      const hours = (nowMs - since) / HOUR;
      if (hours >= 24) {
        out.push({
          type: "potential_lost_deal",
          severity: hours >= 72 ? "critical" : "high",
          dedupeKey: `potential_lost_deal:${s.propertyId}`,
          portalListingId: confirmed[0].id,
          details: { hoursSinceMissing: Math.floor(hours), portals: confirmed.map((l) => l.portal) },
          slaDueAt: slaDue,
        });
      }
    }
  }

  // 6) Satılmış/kiralanmış portföy hâlâ portalda (veri hazır; hemen).
  if ((s.stage === "sold" || s.stage === "rented") && s.listings.some((l) => !isMissingState(l.state))) {
    out.push({
      type: "sold_still_listed",
      severity: "high",
      dedupeKey: `sold_still_listed:${s.propertyId}`,
      portalListingId: null,
      details: { stage: s.stage, portals: s.listings.filter((l) => !isMissingState(l.state)).map((l) => l.portal) },
      slaDueAt: slaDue,
    });
  }

  // 7) Eksik kapanış: kapanış maddeleri eksik, X gün.
  if (s.closure && s.closure.missingItems.length > 0) {
    const days = (nowMs - Date.parse(s.closure.closedAt)) / DAY;
    if (days >= cfg.closure.incompleteDays) {
      out.push({
        type: "incomplete_closure",
        severity: days >= cfg.closure.incompleteDays * 4 ? "high" : "medium",
        dedupeKey: `incomplete_closure:${s.propertyId}`,
        portalListingId: null,
        details: { missingItems: s.closure.missingItems, daysOpen: Math.floor(days) },
        slaDueAt: null,
      });
    }
  }

  // 8) Yetki bitişi: 30 / 15 / 0 gün.
  if (s.active) {
    const left = authorityDaysLeft(s.authorizationEnd, nowMs);
    if (left !== null && left <= cfg.authority.warnDays) {
      out.push({
        type: "authority_expiring",
        severity: left < 0 ? "high" : left <= cfg.authority.urgentDays ? "medium" : "low",
        dedupeKey: `authority_expiring:${s.propertyId}`,
        portalListingId: null,
        details: { daysLeft: left, authorizationEnd: s.authorizationEnd },
        slaDueAt: null,
      });
    }
  }

  return out;
}
