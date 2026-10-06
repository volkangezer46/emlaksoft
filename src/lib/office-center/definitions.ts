/**
 * Tanımlamalar ⇄ ayar kayıt defteri anahtar eşlemesi (SAF). Ofis Merkezi "Tanımlamalar" sekmesi yapılandırılmış
 * formlar sunar; her alan `src/lib/settings/registry/tenant.ts` anahtarına yazılır (ayrı depo YOK, kopya YOK).
 * Okuma: `getSettings(keys, {tenantId})` tipli değer; yazma: `writeSetting` (doğrulama + geçmiş + yetki orada).
 */
import { ASSIGN_SLA_HOURS_KEY, ASSIGN_WEIGHT_KEYS, NOTIFY_DEFAULTS, notifyKey, UNASSIGNED_ALERT_KEY } from "@/lib/settings/registry/tenant";
import type { SmartWeights } from "./smart-assign";
import type { AlertThresholdDefinition, CommissionDefinition, NotificationChannelDefinition, SlaDefinition } from "./types";

export const SLA_KEYS: Record<keyof SlaDefinition, string> = {
  leadFirstResponseMin: "office.sla.lead_first_response_min",
  unassignedSlaHours: ASSIGN_SLA_HOURS_KEY,
};

export const COMMISSION_KEYS: Record<keyof CommissionDefinition, string> = {
  defaultRate: "office.commission.default_rate",
  splitAdvisorShare: "office.commission.split_advisor_share",
  simulatorRate: "office.commission.simulator_rate",
  simulatorAdvisorShare: "office.commission.simulator_advisor_share",
};

export const THRESHOLD_KEYS: Record<keyof AlertThresholdDefinition, string> = {
  dealStaleDays: "office.alert.deal_stale_days",
  demandAgingDays: "office.alert.demand_aging_days",
  unassignedPoolCount: UNASSIGNED_ALERT_KEY,
  customerQuietDays: "office.insight.customer_quiet_days",
  listingStaleDays: "office.insight.listing_stale_days",
  dormantDays: "office.insight.dormant_days",
};

export const WEIGHT_KEYS: Record<keyof SmartWeights, string> = ASSIGN_WEIGHT_KEYS;

export const NOTIFY_CHANNEL_IDS: readonly string[] = NOTIFY_DEFAULTS.map((n) => n.id);

/** Tüm tanımlama anahtarları (tek okuma turu için). */
export function definitionKeys(): string[] {
  return [
    ...Object.values(SLA_KEYS),
    ...Object.values(COMMISSION_KEYS),
    ...Object.values(THRESHOLD_KEYS),
    ...Object.values(WEIGHT_KEYS),
    ...NOTIFY_CHANNEL_IDS.map(notifyKey),
  ];
}

type Settings = Record<string, unknown>;
const num = (v: unknown, def: number): number => (typeof v === "number" && Number.isFinite(v) ? v : def);

export type DefinitionsSnapshot = {
  sla: SlaDefinition;
  commission: CommissionDefinition;
  thresholds: AlertThresholdDefinition;
  weights: SmartWeights;
  notify: NotificationChannelDefinition;
};

/** Tipli ayar sözlüğünden tanımlama yapıları (eksik/bozuk değer registry varsayılanına düşer: getSettings bunu garanti eder). */
export function definitionsFromSettings(s: Settings): DefinitionsSnapshot {
  // `office.sla.lead_first_response_min` enum (metin) saklanır; sayıya çevrilir.
  const leadMin = Number(s[SLA_KEYS.leadFirstResponseMin]);
  const notify: NotificationChannelDefinition = {};
  for (const n of NOTIFY_DEFAULTS) {
    const v = s[notifyKey(n.id)];
    notify[n.id] = typeof v === "boolean" ? v : n.default;
  }
  return {
    sla: {
      leadFirstResponseMin: Number.isFinite(leadMin) ? leadMin : 60,
      unassignedSlaHours: num(s[SLA_KEYS.unassignedSlaHours], 24),
    },
    commission: {
      defaultRate: num(s[COMMISSION_KEYS.defaultRate], 3),
      splitAdvisorShare: num(s[COMMISSION_KEYS.splitAdvisorShare], 50),
      simulatorRate: num(s[COMMISSION_KEYS.simulatorRate], 3),
      simulatorAdvisorShare: num(s[COMMISSION_KEYS.simulatorAdvisorShare], 60),
    },
    thresholds: {
      dealStaleDays: num(s[THRESHOLD_KEYS.dealStaleDays], 14),
      demandAgingDays: num(s[THRESHOLD_KEYS.demandAgingDays], 30),
      unassignedPoolCount: num(s[THRESHOLD_KEYS.unassignedPoolCount], 5),
      customerQuietDays: num(s[THRESHOLD_KEYS.customerQuietDays], 14),
      listingStaleDays: num(s[THRESHOLD_KEYS.listingStaleDays], 30),
      dormantDays: num(s[THRESHOLD_KEYS.dormantDays], 90),
    },
    weights: {
      workload: num(s[WEIGHT_KEYS.workload], 25),
      specialty: num(s[WEIGHT_KEYS.specialty], 20),
      region: num(s[WEIGHT_KEYS.region], 25),
      performance: num(s[WEIGHT_KEYS.performance], 15),
      availability: num(s[WEIGHT_KEYS.availability], 15),
    },
    notify,
  };
}

/** Yapıdan yazılacak {key, value} listesi (metin: writeSetting coerceInput ile tipler). */
export function toWrites<T extends Record<string, number | boolean>>(keys: Record<keyof T, string>, value: T): { key: string; value: string }[] {
  return (Object.keys(keys) as (keyof T)[]).map((k) => ({ key: keys[k], value: typeof value[k] === "boolean" ? (value[k] ? "on" : "off") : String(value[k]) }));
}

export function notifyWrites(def: NotificationChannelDefinition): { key: string; value: string }[] {
  return NOTIFY_CHANNEL_IDS.filter((id) => typeof def[id] === "boolean").map((id) => ({ key: notifyKey(id), value: def[id] ? "on" : "off" }));
}
