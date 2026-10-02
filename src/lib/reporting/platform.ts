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

const priceByPlan = new Map<PlanId, number>(PLANS.map((plan) => [plan.id, plan.monthlyTry]));

export function monthlyPrice(plan: PlanId): number {
  return priceByPlan.get(plan) ?? 0;
}

/** Actual subscription MRR plus catalog fallback only for missing subscriptions. */
export function exactMrr(planStats: readonly PlatformPlanStat[]): number {
  return Math.round(planStats.reduce((total, row) => {
    const missing = Math.max(0, Number(row.active_count) - Number(row.subscription_count));
    return total + Number(row.subscription_mrr) + missing * monthlyPrice(row.plan);
  }, 0));
}

export function exactTrendMrr(row: PlatformMrrTrendRow): number {
  const fallback = PLANS.reduce((total, plan) => {
    const tenantCount = Number(row[`${plan.id}_count` as keyof PlatformMrrTrendRow] ?? 0);
    const subscriptionCount = Number(row[`${plan.id}_subscription_count` as keyof PlatformMrrTrendRow] ?? 0);
    return total + Math.max(0, tenantCount - subscriptionCount) * plan.monthlyTry;
  }, 0);
  return Math.round(Number(row.subscription_mrr) + fallback);
}
