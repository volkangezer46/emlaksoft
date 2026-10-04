import "server-only";

import { PLANS, type PlanId } from "@/lib/billing/plans";

export type PlatformPlanStat = {
  plan: PlanId;
  tenant_count: number;
  active_count: number;
  subscription_count: number;
  subscription_mrr: number;
};

export type PlatformStatusStat = {
  status: string;
  tenant_count: number;
};

export type PlatformMrrTrendRow = {
  month_start: string;
  subscription_mrr: number;
  advisor_count: number;
  advisor_subscription_count: number;
  office_count: number;
  office_subscription_count: number;
  professional_count: number;
  professional_subscription_count: number;
  enterprise_count: number;
  enterprise_subscription_count: number;
};

export type PlatformReportingAggregate = {
  summary: {
    tenant_count: number;
    active_count: number;
    trial_count: number;
    risk_count: number;
    cancelled_count: number;
    trials_ending_7d: number;
    member_count: number;
    ticket_count: number;
    open_ticket_count: number;
    urgent_ticket_count: number;
    resolved_ticket_count: number;
    new_demo_count: number;
    subscription_mrr: number;
  };
  plan_stats: PlatformPlanStat[];
  status_stats: PlatformStatusStat[];
  mrr_trend: PlatformMrrTrendRow[];
  weekly: {
    week_start: string;
    tenants: number;
    active_subscriptions: number;
    trials: number;
    tickets: number;
  }[];
  top_tenants: {
    id: string;
    name: string;
    plan: PlanId;
    created_at: string;
    plan_rank: number;
  }[];
  adoption: { module: string; offices: number }[];
  all_tenant_count: number;
};

/** Plan kimliği -> aylık liste fiyatı. Varsayılan kaynak plans.ts; panel düzenlemesi için okuyucudan beslenir. */
export type PlanPriceMap = ReadonlyMap<string, number>;

const defaultPrices: PlanPriceMap = new Map<string, number>(PLANS.map((plan) => [plan.id, plan.monthlyTry]));

/** Plan tanımlarından (gizli dahil) fiyat haritası üretir; `getPlanDefinitions()` çıktısı verilir. */
export function priceMapOf(defs: readonly { id: string; monthlyTry: number }[]): PlanPriceMap {
  return new Map(defs.map((d) => [d.id, d.monthlyTry]));
}

export function monthlyPrice(plan: PlanId, prices: PlanPriceMap = defaultPrices): number {
  return prices.get(plan) ?? defaultPrices.get(plan) ?? 0;
}

/**
 * Gerçek abonelik MRR'ı + yalnız aboneliği EKSİK aktif ofisler için katalog fiyatı.
 * Kayıtlı abonelik tutarı (fatura tutarı) asla katalogdan yeniden hesaplanmaz.
 */
export function exactMrr(planStats: readonly PlatformPlanStat[], prices: PlanPriceMap = defaultPrices): number {
  return Math.round(planStats.reduce((total, row) => {
    const missing = Math.max(0, Number(row.active_count) - Number(row.subscription_count));
    return total + Number(row.subscription_mrr) + missing * monthlyPrice(row.plan, prices);
  }, 0));
}

export function exactTrendMrr(row: PlatformMrrTrendRow, prices: PlanPriceMap = defaultPrices): number {
  const ids = new Set<string>([...defaultPrices.keys(), ...prices.keys()]);
  let fallback = 0;
  for (const id of ids) {
    const tenantCount = Number(row[`${id}_count` as keyof PlatformMrrTrendRow] ?? 0);
    const subscriptionCount = Number(row[`${id}_subscription_count` as keyof PlatformMrrTrendRow] ?? 0);
    fallback += Math.max(0, tenantCount - subscriptionCount) * (prices.get(id) ?? defaultPrices.get(id) ?? 0);
  }
  return Math.round(Number(row.subscription_mrr) + fallback);
}
