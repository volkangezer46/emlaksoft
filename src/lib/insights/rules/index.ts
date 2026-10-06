import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightDraft, InsightKind } from "@/lib/insights/types";
import {
  loadDeadlines,
  loadQuietCustomers,
  loadStaleListings,
  loadStalledDeals,
  loadWeeklySeries,
} from "@/lib/insights/facts";
import { readTenantSettings, numberSetting } from "@/lib/settings/tenant-read";
import { CALL_MIN_QUIET_DAYS, CALL_PRIORITY_RULE_ID, evaluateCallPriority } from "@/lib/insights/rules/call-priority";
import { DEAL_MIN_IDLE_DAYS, DEAL_RISK_RULE_ID, evaluateDealRisk } from "@/lib/insights/rules/deal-risk";
import { PRICE_ACTION_RULE_ID, PRICE_MIN_DAYS, evaluatePriceAction } from "@/lib/insights/rules/price-action";
import { DEADLINE_RULE_ID, evaluateDeadlines } from "@/lib/insights/rules/deadline";
import { ANOMALY_RULE_ID, evaluateAnomalies } from "@/lib/insights/rules/anomaly";

/**
 * KURAL KAYIT LİSTESİ (tek ortak dosya). Sonraki rol paketleri (danışman 5a, yönetim 5b, muhasebe 5c)
 * YALNIZ kendi satırını ekler; engine bu listeyi sırayla koşar. `digest` bir "post" kuralıdır (diğerlerinin çıktısını
 * özetler) ve engine tarafından ayrıca çağrılır, bu listede YOKTUR.
 *
 * Satır sözleşmesi: `run` olguyu yükler ve SAF `evaluate*` fonksiyonuna verir; `nowMs` enjekte edilir.
 */
export type InsightRule = {
  /** Sürümlü kimlik: "deal_risk@1". */
  id: string;
  kind: InsightKind;
  /** Olguyu yükler + değerlendirir. RPC yoksa InsightFactsUnavailable fırlatır (engine "etkin değil" sayar). */
  run: (admin: SupabaseClient, tenantId: string, nowMs: number) => Promise<InsightDraft[]>;
};

/**
 * Ofis eşikleri (Ofis Tanımları Merkezi): kural çalıştırıcısına verilen `admin` ile, AÇIK tenant_id parametresiyle okunur
 * (yeni istemci oluşturulmaz). Kayıt yoksa/okunamazsa bugünkü sabitler (davranış değişmez).
 */
export async function insightThresholds(admin: SupabaseClient, tenantId: string) {
  const v = await readTenantSettings(admin, tenantId, ["office.alert.deal_stale_days", "office.insight.customer_quiet_days", "office.insight.listing_stale_days"]);
  return {
    dealIdleDays: numberSetting(v, "office.alert.deal_stale_days", DEAL_MIN_IDLE_DAYS),
    quietDays: numberSetting(v, "office.insight.customer_quiet_days", CALL_MIN_QUIET_DAYS),
    listingStaleDays: numberSetting(v, "office.insight.listing_stale_days", PRICE_MIN_DAYS),
  };
}

export const INSIGHT_RULES: readonly InsightRule[] = [
  {
    id: CALL_PRIORITY_RULE_ID,
    kind: "call_priority",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      return evaluateCallPriority(await loadQuietCustomers(admin, tenantId, days.quietDays), nowMs, days.quietDays);
    },
  },
  {
    id: DEAL_RISK_RULE_ID,
    kind: "deal_risk",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      return evaluateDealRisk(await loadStalledDeals(admin, tenantId, days.dealIdleDays), nowMs, days.dealIdleDays);
    },
  },
  {
    id: PRICE_ACTION_RULE_ID,
    kind: "price_action",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      return evaluatePriceAction(await loadStaleListings(admin, tenantId, days.listingStaleDays), nowMs, days.listingStaleDays);
    },
  },
  {
    id: DEADLINE_RULE_ID,
    kind: "deadline",
    run: async (admin, tenantId, nowMs) => evaluateDeadlines(await loadDeadlines(admin, tenantId), nowMs),
  },
  {
    id: ANOMALY_RULE_ID,
    kind: "anomaly",
    run: async (admin, tenantId, nowMs) => evaluateAnomalies(await loadWeeklySeries(admin, tenantId), nowMs),
  },
];

export { buildDigestDraft, DIGEST_RULE_ID } from "@/lib/insights/rules/digest";
