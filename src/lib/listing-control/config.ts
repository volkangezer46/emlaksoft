import type { SourceKind } from "./types";

/**
 * Ofis bazlı AYARLANABİLİR eşikler/ağırlıklar (SAF). Saklama: `oversight_settings.listing_control jsonb`
 * (yeni ayar tablosu YOK; migration 20260826002010). Kolon/satır yokken ya da bozuk değerde VARSAYILANLAR kullanılır
 * (src/lib/oversight/settings.ts normalizasyon deseni): her alan aralığa kırpılır, bilinmeyen alan atılır.
 */

export type StateMachineConfig = {
  /** İki "yok" gözleminin ayrı sayılması için asgari ara (dk). SQL: min_gap_minutes. */
  minGapMinutes: number;
  /** Tek istemciyle 3. gözlemin geçerli sayılması için ilk "yok"tan beri asgari süre (saat). */
  singleClientWaitHours: number;
  confidence: {
    suspect: number;
    probable: number;
    confirmedMultiClient: number;
    confirmedSingleClient: number;
    manualAbsent: number;
    bySource: Record<SourceKind, number>;
  };
};

export type CadenceConfig = {
  newListingDays: number;
  newListingHours: number;
  normalHours: number;
  criticalHours: number;
  criticalRiskThreshold: number;
  oldListingDays: number;
  oldListingHours: number;
  suspectRecheckMinutes: number;
  failureBackoffBaseMinutes: number;
  failureBackoffMaxMinutes: number;
  /** Bu süreden eski başarılı kontrolü olmayan ilan "kontrol edilemeyen" sayılır (saat). */
  staleAfterHours: number;
};

export type RiskWeights = {
  portalMissing: number;
  noCrmAction: number;
  noExplanation: number;
  priceChanged: number;
  authorityExpired: number;
};

export type HealthWeights = {
  onPortal: number;
  price: number;
  advisor: number;
  authority: number;
  photos: number;
  freshness: number;
  idUrlValid: number;
  contact: number;
  eids: number;
  checkRecency: number;
};

export type SlaConfig = {
  /** Anomali açıldıktan sonra kademelerin devreye girdiği saatler. */
  teamLeadHours: number;
  branchManagerHours: number;
  ownerHours: number;
};

export type ListingControlConfig = {
  stateMachine: StateMachineConfig;
  cadence: CadenceConfig;
  unpublished: { warnHours: number; criticalHours: number };
  price: { toleranceRatio: number; criticalRatio: number };
  sla: SlaConfig;
  riskWeights: RiskWeights;
  healthWeights: HealthWeights;
  duplicate: { thresholdPercent: number };
  authority: { warnDays: number; urgentDays: number };
  closure: { incompleteDays: number };
  healthColors: { green: number; yellow: number; orange: number };
  /** Bu skor ve üstü + engelleyici anomali yok = sağlıklı KPI'ı. */
  healthyMinScore: number;
};

export const DEFAULT_LISTING_CONTROL_CONFIG: ListingControlConfig = {
  stateMachine: {
    minGapMinutes: 10,
    singleClientWaitHours: 6,
    confidence: {
      suspect: 0.3,
      probable: 0.7,
      confirmedMultiClient: 0.95,
      confirmedSingleClient: 0.85,
      manualAbsent: 0.9,
      bySource: { api: 0.95, feed: 0.85, csv: 0.85, assisted: 0.7, manual: 0.9 },
    },
  },
  cadence: {
    newListingDays: 7,
    newListingHours: 6,
    normalHours: 24,
    criticalHours: 6,
    criticalRiskThreshold: 60,
    oldListingDays: 60,
    oldListingHours: 12,
    suspectRecheckMinutes: 15,
    failureBackoffBaseMinutes: 30,
    failureBackoffMaxMinutes: 240,
    staleAfterHours: 72,
  },
  unpublished: { warnHours: 24, criticalHours: 48 },
  price: { toleranceRatio: 0.01, criticalRatio: 0.05 },
  sla: { teamLeadHours: 4, branchManagerHours: 8, ownerHours: 24 },
  riskWeights: { portalMissing: 30, noCrmAction: 30, noExplanation: 20, priceChanged: 10, authorityExpired: 10 },
  healthWeights: {
    onPortal: 25,
    price: 15,
    advisor: 10,
    authority: 10,
    photos: 10,
    freshness: 8,
    idUrlValid: 7,
    contact: 5,
    eids: 5,
    checkRecency: 5,
  },
  duplicate: { thresholdPercent: 90 },
  authority: { warnDays: 30, urgentDays: 15 },
  closure: { incompleteDays: 7 },
  healthColors: { green: 85, yellow: 60, orange: 40 },
  healthyMinScore: 85,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function rec(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

/** Ham jsonb → güvenli yapılandırma. Asla fırlatmaz. */
export function normalizeListingControlConfig(raw: unknown): ListingControlConfig {
  const d = DEFAULT_LISTING_CONTROL_CONFIG;
  const r = rec(raw);
  const sm = rec(r.stateMachine);
  const conf = rec(sm.confidence);
  const src = rec(conf.bySource);
  const cad = rec(r.cadence);
  const unp = rec(r.unpublished);
  const pr = rec(r.price);
  const sla = rec(r.sla);
  const rw = rec(r.riskWeights);
  const hw = rec(r.healthWeights);
  const dup = rec(r.duplicate);
  const au = rec(r.authority);
  const cl = rec(r.closure);
  const hc = rec(r.healthColors);

  const warnHours = num(unp.warnHours, d.unpublished.warnHours, 1, 24 * 14);
  const teamLead = num(sla.teamLeadHours, d.sla.teamLeadHours, 1, 24 * 7);
  const branch = Math.max(teamLead, num(sla.branchManagerHours, d.sla.branchManagerHours, 1, 24 * 14));
  const owner = Math.max(branch, num(sla.ownerHours, d.sla.ownerHours, 1, 24 * 30));
  const green = num(hc.green, d.healthColors.green, 1, 100);
  const yellow = Math.min(green, num(hc.yellow, d.healthColors.yellow, 1, 100));
  const orange = Math.min(yellow, num(hc.orange, d.healthColors.orange, 1, 100));

  return {
    stateMachine: {
      minGapMinutes: num(sm.minGapMinutes, d.stateMachine.minGapMinutes, 1, 120),
      singleClientWaitHours: num(sm.singleClientWaitHours, d.stateMachine.singleClientWaitHours, 1, 72),
      confidence: {
        suspect: num(conf.suspect, d.stateMachine.confidence.suspect, 0, 1),
        probable: num(conf.probable, d.stateMachine.confidence.probable, 0, 1),
        confirmedMultiClient: num(conf.confirmedMultiClient, d.stateMachine.confidence.confirmedMultiClient, 0, 1),
        confirmedSingleClient: num(conf.confirmedSingleClient, d.stateMachine.confidence.confirmedSingleClient, 0, 1),
        manualAbsent: num(conf.manualAbsent, d.stateMachine.confidence.manualAbsent, 0, 1),
        bySource: {
          api: num(src.api, d.stateMachine.confidence.bySource.api, 0, 1),
          feed: num(src.feed, d.stateMachine.confidence.bySource.feed, 0, 1),
          csv: num(src.csv, d.stateMachine.confidence.bySource.csv, 0, 1),
          assisted: num(src.assisted, d.stateMachine.confidence.bySource.assisted, 0, 1),
          manual: num(src.manual, d.stateMachine.confidence.bySource.manual, 0, 1),
        },
      },
    },
    cadence: {
      newListingDays: num(cad.newListingDays, d.cadence.newListingDays, 1, 60),
      newListingHours: num(cad.newListingHours, d.cadence.newListingHours, 1, 168),
      normalHours: num(cad.normalHours, d.cadence.normalHours, 1, 168),
      criticalHours: num(cad.criticalHours, d.cadence.criticalHours, 1, 48),
      criticalRiskThreshold: num(cad.criticalRiskThreshold, d.cadence.criticalRiskThreshold, 1, 100),
      oldListingDays: num(cad.oldListingDays, d.cadence.oldListingDays, 7, 720),
      oldListingHours: num(cad.oldListingHours, d.cadence.oldListingHours, 1, 168),
      suspectRecheckMinutes: num(cad.suspectRecheckMinutes, d.cadence.suspectRecheckMinutes, 5, 240),
      failureBackoffBaseMinutes: num(cad.failureBackoffBaseMinutes, d.cadence.failureBackoffBaseMinutes, 5, 240),
      failureBackoffMaxMinutes: num(cad.failureBackoffMaxMinutes, d.cadence.failureBackoffMaxMinutes, 30, 1440),
      staleAfterHours: num(cad.staleAfterHours, d.cadence.staleAfterHours, 6, 24 * 30),
    },
    unpublished: {
      warnHours,
      criticalHours: Math.max(warnHours, num(unp.criticalHours, d.unpublished.criticalHours, 1, 24 * 30)),
    },
    price: {
      toleranceRatio: num(pr.toleranceRatio, d.price.toleranceRatio, 0, 0.5),
      criticalRatio: Math.max(
        num(pr.toleranceRatio, d.price.toleranceRatio, 0, 0.5),
        num(pr.criticalRatio, d.price.criticalRatio, 0, 1),
      ),
    },
    sla: { teamLeadHours: teamLead, branchManagerHours: branch, ownerHours: owner },
    riskWeights: {
      portalMissing: num(rw.portalMissing, d.riskWeights.portalMissing, 0, 100),
      noCrmAction: num(rw.noCrmAction, d.riskWeights.noCrmAction, 0, 100),
      noExplanation: num(rw.noExplanation, d.riskWeights.noExplanation, 0, 100),
      priceChanged: num(rw.priceChanged, d.riskWeights.priceChanged, 0, 100),
      authorityExpired: num(rw.authorityExpired, d.riskWeights.authorityExpired, 0, 100),
    },
    healthWeights: {
      onPortal: num(hw.onPortal, d.healthWeights.onPortal, 0, 100),
      price: num(hw.price, d.healthWeights.price, 0, 100),
      advisor: num(hw.advisor, d.healthWeights.advisor, 0, 100),
      authority: num(hw.authority, d.healthWeights.authority, 0, 100),
      photos: num(hw.photos, d.healthWeights.photos, 0, 100),
      freshness: num(hw.freshness, d.healthWeights.freshness, 0, 100),
      idUrlValid: num(hw.idUrlValid, d.healthWeights.idUrlValid, 0, 100),
      contact: num(hw.contact, d.healthWeights.contact, 0, 100),
      eids: num(hw.eids, d.healthWeights.eids, 0, 100),
      checkRecency: num(hw.checkRecency, d.healthWeights.checkRecency, 0, 100),
    },
    duplicate: { thresholdPercent: num(dup.thresholdPercent, d.duplicate.thresholdPercent, 50, 100) },
    authority: {
      warnDays: num(au.warnDays, d.authority.warnDays, 1, 180),
      urgentDays: Math.min(num(au.warnDays, d.authority.warnDays, 1, 180), num(au.urgentDays, d.authority.urgentDays, 0, 90)),
    },
    closure: { incompleteDays: num(cl.incompleteDays, d.closure.incompleteDays, 1, 90) },
    healthColors: { green, yellow, orange },
    healthyMinScore: num(r.healthyMinScore, d.healthyMinScore, 1, 100),
  };
}
