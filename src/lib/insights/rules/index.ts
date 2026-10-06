import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightDraft, InsightKind } from "@/lib/insights/types";
import {
  loadDeadlines,
  loadQuietCustomers,
  loadStaleListings,
  loadStalledDeals,
  loadWeeklySeries,
} from "@/lib/insights/facts";
import { CALL_PRIORITY_RULE_ID, evaluateCallPriority } from "@/lib/insights/rules/call-priority";
import { DEAL_RISK_RULE_ID, evaluateDealRisk } from "@/lib/insights/rules/deal-risk";
import { PRICE_ACTION_RULE_ID, evaluatePriceAction } from "@/lib/insights/rules/price-action";
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

export const INSIGHT_RULES: readonly InsightRule[] = [
  {
    id: CALL_PRIORITY_RULE_ID,
    kind: "call_priority",
    run: async (admin, tenantId, nowMs) => evaluateCallPriority(await loadQuietCustomers(admin, tenantId), nowMs),
  },
  {
    id: DEAL_RISK_RULE_ID,
    kind: "deal_risk",
    run: async (admin, tenantId, nowMs) => evaluateDealRisk(await loadStalledDeals(admin, tenantId), nowMs),
  },
  {
    id: PRICE_ACTION_RULE_ID,
    kind: "price_action",
    run: async (admin, tenantId, nowMs) => evaluatePriceAction(await loadStaleListings(admin, tenantId), nowMs),
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
