import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightDraft, InsightKind } from "@/lib/insights/types";
import {
  InsightFactsUnavailable,
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
import { LIFECYCLE_RULE_ID, evaluateLifecycle } from "@/lib/insights/rules/lifecycle";
import { loadLifecycleFacts } from "@/lib/insights/lifecycle-facts";
import {
  AUTHORITY_RENEWAL_RULE_ID,
  HOME_VALUE_RULE_ID,
  PRICE_REVISION_RULE_ID,
  REFERRAL_INVITE_RULE_ID,
  UNSHOWN_MATCH_RULE_ID,
  evaluateAuthorityRenewal,
  evaluateHomeValue,
  evaluatePriceRevision,
  evaluateReferralInvites,
  evaluateUnshownMatches,
} from "@/lib/insights/rules/revenue";
import {
  loadAuthorityRenewals,
  loadHomeValueFacts,
  loadPriceRevisionFacts,
  loadReferralInviteFacts,
  loadUnshownMatches,
} from "@/lib/insights/revenue-facts";
import {
  EXPENSE_BUDGET_RULE_ID,
  PORTAL_ROI_RULE_ID,
  SUBSCRIPTION_RULE_ID,
  evaluateExpenseBudgets,
  evaluatePortalRoi,
  evaluateSubscriptions,
} from "@/lib/insights/rules/finance";
import { loadBudgetContext, loadPortalRoi, loadRecurringSeries } from "@/lib/finance/load";
import { pickLeastEfficientPortal, unusedPortalSubscriptions } from "@/lib/finance/portal-roi";
import { EXPENSE_CATEGORIES } from "@/lib/definition-defaults";
import { trNextMonthStartMs } from "@/lib/clock";

const categoryLabel = (value: string): string => EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;

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
  {
    // Satış sonrası / yeniden satış / çapraz satış (alımın 3-5. yılı, kira bitişine 90 gün, evini satan malik).
    id: LIFECYCLE_RULE_ID,
    kind: "match_suggestion",
    run: async (admin, tenantId, nowMs) => evaluateLifecycle(await loadLifecycleFacts(admin, tenantId, nowMs), nowMs),
  },
  // GELİR FIRSATLARI (saf kurallar: rules/revenue.ts; olgular: revenue-facts.ts). Her biri ofis ayarından ayrı kapatılabilir.
  {
    id: AUTHORITY_RENEWAL_RULE_ID,
    kind: "deadline",
    run: async (admin, tenantId, nowMs) => evaluateAuthorityRenewal(await loadAuthorityRenewals(admin, tenantId, nowMs), nowMs),
  },
  {
    id: UNSHOWN_MATCH_RULE_ID,
    kind: "match_suggestion",
    run: async (admin, tenantId, nowMs) => evaluateUnshownMatches(await loadUnshownMatches(admin, tenantId, nowMs), nowMs),
  },
  {
    id: HOME_VALUE_RULE_ID,
    kind: "match_suggestion",
    run: async (admin, tenantId, nowMs) => evaluateHomeValue(await loadHomeValueFacts(admin, tenantId, nowMs), nowMs),
  },
  {
    id: PRICE_REVISION_RULE_ID,
    kind: "price_action",
    run: async (admin, tenantId, nowMs) => evaluatePriceRevision(await loadPriceRevisionFacts(admin, tenantId, nowMs), nowMs),
  },
  {
    id: REFERRAL_INVITE_RULE_ID,
    kind: "match_suggestion",
    run: async (admin, tenantId, nowMs) => evaluateReferralInvites(await loadReferralInviteFacts(admin, tenantId, nowMs), nowMs),
  },
  // GİDER içgörüleri (alıcı: yönetim). Şema (20261008000700) yoksa kural "etkin değil" sayılır.
  {
    id: EXPENSE_BUDGET_RULE_ID,
    kind: "anomaly",
    run: async (admin, tenantId, nowMs) => {
      const ctx = await loadBudgetContext(admin, tenantId, nowMs);
      if (!ctx.available) throw new InsightFactsUnavailable("expense_budgets");
      return evaluateExpenseBudgets(
        { monthKey: ctx.monthKey, monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, rows: ctx.rows.map((r) => ({ ...r, label: categoryLabel(r.category) })) },
        nowMs,
        trNextMonthStartMs(nowMs),
      );
    },
  },
  {
    id: SUBSCRIPTION_RULE_ID,
    kind: "deadline",
    run: async (admin, tenantId, nowMs) => {
      const [recurring, portal] = await Promise.all([loadRecurringSeries(admin, tenantId, nowMs), loadPortalRoi(admin, tenantId, nowMs)]);
      if (!recurring.available) throw new InsightFactsUnavailable("expenses.recurrence");
      return evaluateSubscriptions(
        {
          todayKey: recurring.todayKey,
          series: recurring.series.map((s) => ({ ...s, categoryLabel: categoryLabel(s.category) })),
          unusedPortals: portal.available ? unusedPortalSubscriptions(portal.rows) : [],
        },
        nowMs,
      );
    },
  },
  {
    id: PORTAL_ROI_RULE_ID,
    kind: "anomaly",
    run: async (admin, tenantId, nowMs) => {
      const portal = await loadPortalRoi(admin, tenantId, nowMs);
      if (!portal.available) throw new InsightFactsUnavailable("expenses.portal_key");
      return evaluatePortalRoi(pickLeastEfficientPortal(portal.rows), portal.rows, nowMs);
    },
  },
];

export { buildDigestDraft, DIGEST_RULE_ID } from "@/lib/insights/rules/digest";
