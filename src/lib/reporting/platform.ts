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

/**
 * Ay satırı (20261016060500 sonrası): o TR ayının SON `platform_mrr_daily` anlık görüntü günü (iç ofisler hariç).
 * Anlık görüntüsü olmayan ay satır üretmez ("veri yok"). `*_count` = o gün MRR'ı > 0 olan ofis; `*_subscription_count` aynı.
 */
export type PlatformMrrTrendRow = {
  month_start: string;
  /** TR ayı "YYYY-AA" (migration öncesi yanıtlarda yok). */
  ym?: string;
  /** Ayın kullanılan anlık görüntü günü (migration öncesi yanıtlarda yok). */
  snap_day?: string;
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
    /** Aktif ama aktif aboneliği olmayan (iç olmayan) ofis: MRR'a 0 ekler, ayrı uyarı sayacıdır (20261016060500). */
    missing_subscription_count?: number;
    /** Platform metriklerinden çıkarılan iç/test/demo ofis sayısı (tenants.is_internal; 20261016060500). */
    internal_count?: number;
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

export function monthlyPrice(plan: string, prices: PlanPriceMap = defaultPrices): number {
  return prices.get(plan) ?? defaultPrices.get(plan) ?? 0;
}

/**
 * MRR = aktif aboneliklerin kayıtlı `amount_try` toplamı (fatura tutarı; katalogdan yeniden hesaplanmaz).
 * Aboneliği eksik aktif ofis MRR'a 0 ekler: katalog fiyatı YEDEĞİ YOK (bkz. `missingSubscriptionCount`, ayrı uyarı).
 * İç/test/demo ofisler RPC kapsamında zaten yoktur (tenants.is_internal). `_prices` imza uyumu için kalır, kullanılmaz.
 */
export function exactMrr(planStats: readonly PlatformPlanStat[], _prices: PlanPriceMap = defaultPrices): number {
  return Math.round(planStats.reduce((total, row) => {
    const v = Number(row.subscription_mrr);
    return total + (Number.isFinite(v) ? v : 0);
  }, 0));
}

/** Ay satırının MRR'ı: o ayın son anlık görüntüsündeki abonelik toplamı (katalog yedeği yok; `_prices` imza uyumu için). */
export function exactTrendMrr(row: PlatformMrrTrendRow, _prices: PlanPriceMap = defaultPrices): number {
  const v = Number(row.subscription_mrr);
  return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Aktif ama aktif aboneliği olmayan ofis sayısı (MRR'a 0 ekler; "aboneliği eksik ofis" uyarı sayacı).
 * RPC alanı (`summary.missing_subscription_count`) yoksa (migration öncesi) plan satırlarından alt sınır olarak türetilir.
 */
export function missingSubscriptionCount(aggregate: Pick<PlatformReportingAggregate, "summary" | "plan_stats">): number {
  const direct = Number(aggregate.summary.missing_subscription_count);
  if (aggregate.summary.missing_subscription_count !== undefined && Number.isFinite(direct)) return Math.max(0, Math.round(direct));
  return aggregate.plan_stats.reduce((n, row) => n + Math.max(0, Number(row.active_count) - Number(row.subscription_count)), 0);
}

/** Aktif abonelik sayısı (iç ofisler hariç): plan satırlarının `subscription_count` toplamı — MRR ile aynı küme. */
export function activeSubscriptionCount(planStats: readonly PlatformPlanStat[]): number {
  return planStats.reduce((n, row) => n + (Number(row.subscription_count) || 0), 0);
}

/** Yıllık yinelenen gelir: MRR × 12 (tek formül; muhasebe ve paneller aynı kaynağı kullanır). */
export function exactArr(mrr: number): number {
  return Math.round(mrr * 12);
}
