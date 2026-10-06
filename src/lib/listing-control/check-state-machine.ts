import type { StateMachineConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import { isAuthoritativeSource, type CheckResultKind, type CheckState, type SourceKind } from "./types";

/**
 * ŞÜPHELİ → ONAYLI KAYIP durum makinesi (SAF). SQL eşi: `lc_apply_check` (20260826002050) — aynı kurallar:
 *
 *  - TEK başarısız kontrol "silindi" DEĞİLDİR. Asistanlı kaynakta: 1. "yok" = şüpheli (0.30), 2. = olası kayıp (0.70),
 *    3. = ONAYLI kayıp (0.95 farklı istemci / 0.85 tek istemci ve ilk "yok"tan ≥ 6 saat sonra). Koşul sağlanmazsa
 *    olası kayıpta kalır. Resmi kaynak (api/feed/csv): 1. şüpheli, 2. onaylı.
 *  - Gözlemler arasında en az `minGapMinutes` (10) olmadan sayaç ARTMAZ (aynı anda iki kontrol = tek gözlem).
 *  - `blocked` / `error` (giriş duvarı, CAPTCHA, 403/429, zaman aşımı, 5xx) ASLA "yok" sayılmaz: durum `unverifiable`
 *    (mevcut şüpheli/olası/onaylı kayıp durumu korunur), sayaç değişmez, yeniden deneme üstel geri çekilmeyle.
 *  - `present` her durumu `verified`'a döndürür, sayaç sıfırlanır.
 *  - Elle "portalda yok" (manual) → onaylı kayıp, güven 0.90.
 *  - `paused` durumdaki ilan manual dışı kaynaktan sonuç almaz.
 *
 * NOT: güven sabitleri SQL'de de bu varsayılanlarla yazılıdır (contract test eşitliği denetler); ofis `minGapMinutes` ve
 * `singleClientWaitHours` değerlerini RPC'ye `p_policy` ile geçirir. Güven eşiklerinin ofis bazlı değişimi YOK (sahte
 * ayar vaadi olmasın diye `policyForRpc` yalnız gerçekten uygulananları taşır).
 */

export type CheckSnapshot = {
  state: CheckState;
  confidence: number | null;
  consecutiveAbsent: number;
  firstAbsentAt: string | null;
  lastAbsentAt: string | null;
  absentClientIds: string[];
  checkFailures: number;
  errorCode: string | null;
  portalPrice: number | null;
  lastSeenAt: string | null;
  lastSuccessAt: string | null;
  lastCheckAt: string | null;
};

export type Observation = {
  result: CheckResultKind;
  sourceKind: SourceKind;
  clientId?: string | null;
  /** ISO. Çağıran verir (saat sızıntısı yok). */
  at: string;
  price?: number | null;
  errorCode?: string | null;
};

export type Transition = {
  next: CheckSnapshot;
  stateChanged: boolean;
  /** Bu gözlem "yok" sayacını artırdı mı. */
  countedAbsent: boolean;
  /** Gözlem yok sayıldı (duraklatılmış ilan). */
  ignored: boolean;
  /** Güvenli varsayılan sonraki kontrol zamanı (planlayıcı `cadence.ts` ile inceltebilir). */
  nextCheckAt: string;
};

export const INITIAL_SNAPSHOT: CheckSnapshot = {
  state: "unchecked",
  confidence: null,
  consecutiveAbsent: 0,
  firstAbsentAt: null,
  lastAbsentAt: null,
  absentClientIds: [],
  checkFailures: 0,
  errorCode: null,
  portalPrice: null,
  lastSeenAt: null,
  lastSuccessAt: null,
  lastCheckAt: null,
};

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** RPC `p_policy` gövdesi: yalnız SQL'in gerçekten okuduğu anahtarlar. */
export function policyForRpc(
  sm: StateMachineConfig,
  normalHours: number,
): { min_gap_minutes: number; single_client_wait_hours: number; normal_hours: number } {
  return {
    min_gap_minutes: Math.round(sm.minGapMinutes),
    single_client_wait_hours: Math.round(sm.singleClientWaitHours),
    normal_hours: Math.round(normalHours),
  };
}

export function applyObservation(
  prev: CheckSnapshot,
  obs: Observation,
  sm: StateMachineConfig = DEFAULT_LISTING_CONTROL_CONFIG.stateMachine,
  normalHours: number = DEFAULT_LISTING_CONTROL_CONFIG.cadence.normalHours,
): Transition {
  const at = Date.parse(obs.at);
  if (!Number.isFinite(at)) throw new Error("applyObservation: geçersiz zaman");
  const authoritative = isAuthoritativeSource(obs.sourceKind);

  if (prev.state === "paused" && obs.sourceKind !== "manual") {
    return { next: prev, stateChanged: false, countedAbsent: false, ignored: true, nextCheckAt: prev.lastCheckAt ?? obs.at };
  }

  const next: CheckSnapshot = {
    ...prev,
    absentClientIds: [...prev.absentClientIds],
    lastCheckAt: obs.at,
  };
  let countedAbsent = false;
  let nextCheckMs: number;

  if (obs.result === "present") {
    next.state = "verified";
    next.confidence = sm.confidence.bySource[obs.sourceKind];
    next.consecutiveAbsent = 0;
    next.firstAbsentAt = null;
    next.lastAbsentAt = null;
    next.absentClientIds = [];
    next.checkFailures = 0;
    next.errorCode = null;
    if (typeof obs.price === "number" && Number.isFinite(obs.price)) next.portalPrice = obs.price;
    next.lastSeenAt = obs.at;
    next.lastSuccessAt = obs.at;
    nextCheckMs = at + normalHours * HOUR_MS;
  } else if (obs.result === "absent") {
    next.lastSuccessAt = obs.at;
    if (obs.sourceKind === "manual") {
      next.state = "confirmed_missing";
      next.confidence = sm.confidence.manualAbsent;
      next.consecutiveAbsent = Math.max(prev.consecutiveAbsent, 1);
      next.firstAbsentAt = prev.firstAbsentAt ?? obs.at;
      next.lastAbsentAt = obs.at;
      nextCheckMs = at + normalHours * HOUR_MS;
    } else {
      const gapMs = sm.minGapMinutes * MIN_MS;
      countedAbsent = prev.lastAbsentAt === null || at - Date.parse(prev.lastAbsentAt) >= gapMs;
      if (countedAbsent) {
        next.consecutiveAbsent = Math.min(prev.consecutiveAbsent + 1, 100);
        next.lastAbsentAt = obs.at;
        if (obs.clientId && !next.absentClientIds.includes(obs.clientId)) next.absentClientIds.push(obs.clientId);
      }
      next.firstAbsentAt = prev.firstAbsentAt ?? obs.at;
      const need = authoritative ? 2 : 3;
      if (next.consecutiveAbsent >= need) {
        const independent = !!obs.clientId && next.absentClientIds.length >= 2;
        const waited = at - Date.parse(next.firstAbsentAt) >= sm.singleClientWaitHours * HOUR_MS;
        if (authoritative) {
          next.state = "confirmed_missing";
          next.confidence = sm.confidence.bySource[obs.sourceKind];
        } else if (independent) {
          next.state = "confirmed_missing";
          next.confidence = sm.confidence.confirmedMultiClient;
        } else if (waited) {
          next.state = "confirmed_missing";
          next.confidence = sm.confidence.confirmedSingleClient;
        } else {
          next.state = "probable_missing";
          next.confidence = sm.confidence.probable;
        }
      } else if (next.consecutiveAbsent === 1) {
        next.state = "suspect";
        next.confidence = sm.confidence.suspect;
      } else {
        next.state = "probable_missing";
        next.confidence = sm.confidence.probable;
      }
      nextCheckMs =
        next.state === "confirmed_missing" ? at + normalHours * HOUR_MS : at + Math.max(sm.minGapMinutes, 10) * MIN_MS;
    }
  } else {
    // blocked / error: ASLA kayıp değil.
    next.checkFailures = Math.min(prev.checkFailures + 1, 100);
    next.errorCode = (obs.errorCode?.trim() || obs.result).slice(0, 60);
    next.state =
      prev.state === "suspect" || prev.state === "probable_missing" || prev.state === "confirmed_missing"
        ? prev.state
        : "unverifiable";
    // SQL: min(240, 30 * 2^min(failures-1, 3)) dk.
    const backoff = Math.min(240, 30 * 2 ** Math.min(next.checkFailures - 1, 3));
    nextCheckMs = at + backoff * MIN_MS;
  }

  return {
    next,
    stateChanged: next.state !== prev.state,
    countedAbsent,
    ignored: false,
    nextCheckAt: iso(nextCheckMs),
  };
}

/** Anomali açtıran durumlar (olası/onaylı kayıp). Şüpheli tek başına anomali AÇMAZ. */
export function isMissingState(state: CheckState): boolean {
  return state === "probable_missing" || state === "confirmed_missing";
}
