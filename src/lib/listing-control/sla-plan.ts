import type { SlaConfig } from "./config";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";
import type { AnomalySeverity } from "./types";

/**
 * SLA YÜKSELTME kararı (SAF). Zincir (ayarlanabilir): 0-4 saat danışman → 4. saatte takım lideri → 8. saatte şube
 * müdürü → 24. saatte ofis sahibi. Aşama numaraları `listing_sla_events.stage` ile aynıdır:
 *   1 = danışman (açılış bildirimi), 2 = takım lideri, 3 = şube müdürü, 4 = ofis sahibi.
 * Aynı (anomali, aşama) tekrar bildirilmez (`lc_escalate_anomaly` unique); bu fonksiyon yalnız "hangi aşamalar vadesi
 * geldi ve henüz tetiklenmedi" sorusunu yanıtlar. Alıcı yoksa (takım modeli yok / şube müdürü atanmamış) aşama
 * `deliver=false` döner: kayıt düşülür (tekrar denenmesin) ama bildirim üretilmez. Açıklanmış (explained) anomali
 * yükseltilmez; çağıran yalnız open/acknowledged durumları verir.
 */

export type SlaRecipients = {
  advisorId: string | null;
  teamLeadId: string | null;
  branchManagerId: string | null;
  ownerIds: readonly string[];
};

export type SlaStageDecision = {
  stage: 1 | 2 | 3 | 4;
  role: "advisor" | "team_lead" | "branch_manager" | "owner";
  recipientIds: string[];
  dueAtMs: number;
  deliver: boolean;
};

const HOUR = 3_600_000;

export function planSlaEscalation(input: {
  openedAtMs: number;
  nowMs: number;
  firedStages: readonly number[];
  recipients: SlaRecipients;
  sla?: SlaConfig;
}): SlaStageDecision[] {
  const sla = input.sla ?? DEFAULT_LISTING_CONTROL_CONFIG.sla;
  const stages: { stage: 1 | 2 | 3 | 4; role: SlaStageDecision["role"]; afterHours: number; ids: string[] }[] = [
    { stage: 1, role: "advisor", afterHours: 0, ids: input.recipients.advisorId ? [input.recipients.advisorId] : [] },
    { stage: 2, role: "team_lead", afterHours: sla.teamLeadHours, ids: input.recipients.teamLeadId ? [input.recipients.teamLeadId] : [] },
    { stage: 3, role: "branch_manager", afterHours: sla.branchManagerHours, ids: input.recipients.branchManagerId ? [input.recipients.branchManagerId] : [] },
    { stage: 4, role: "owner", afterHours: sla.ownerHours, ids: [...input.recipients.ownerIds] },
  ];
  const fired = new Set(input.firedStages);
  const out: SlaStageDecision[] = [];
  for (const s of stages) {
    if (fired.has(s.stage)) continue;
    const dueAtMs = input.openedAtMs + s.afterHours * HOUR;
    if (dueAtMs > input.nowMs) continue;
    out.push({ stage: s.stage, role: s.role, recipientIds: s.ids, dueAtMs, deliver: s.ids.length > 0 });
  }
  return out;
}

/** Aşama başına bildirim önem düzeyi (bildirim `kind`'ine eşlenir). */
export function slaNotificationKind(stage: number, severity: AnomalySeverity): "info" | "warning" | "danger" {
  if (stage >= 4 || severity === "critical") return "danger";
  if (stage >= 2 || severity === "high") return "warning";
  return "info";
}

/**
 * Mevcut `leak-sla` cron'unun kapanış önem derecesi (kapanış formu tabanlı SLA; davranış DEĞİŞMEZ). Tek yerde durur
 * ki iki sistem aynı eşikleri kullansın (çoğaltma yok).
 */
export function leakSeverity(dealAmount: number | null, daysOpen: number): "low" | "medium" | "high" | "critical" {
  const amount = dealAmount ?? 0;
  if (daysOpen >= 30 && amount > 500_000) return "critical";
  if (daysOpen >= 14 && amount > 300_000) return "high";
  if (daysOpen >= 7 && amount > 100_000) return "medium";
  return "low";
}
