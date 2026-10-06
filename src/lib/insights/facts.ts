import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuietCustomerFact } from "@/lib/insights/rules/call-priority";
import type { StalledDealFact } from "@/lib/insights/rules/deal-risk";
import type { StaleListingFact } from "@/lib/insights/rules/price-action";
import type { DeadlineFact } from "@/lib/insights/rules/deadline";
import type { AnomalyMetric, WeeklySeriesFact } from "@/lib/insights/rules/anomaly";

/**
 * Olgu yükleyicileri: set-tabanlı RPC'ler (20260826002700_insight_support). `admin` çağıran tarafından verilir
 * (engine; service_role kapalı iş seçiciden gelir) ve HER RPC açık `p_tenant_id` alır. Bu dosya istemci OLUŞTURMAZ.
 * RPC yoksa (migration uygulanmadı) `InsightFactsUnavailable` fırlatır; engine bunu "etkin değil" sayar.
 */

export class InsightFactsUnavailable extends Error {
  constructor(public readonly rpc: string) {
    super(`insight olgu RPC'si kullanılamıyor: ${rpc}`);
    this.name = "InsightFactsUnavailable";
  }
}

type RpcError = { code?: string; message?: string } | null;

/** Şema/fonksiyon yok hatası (migration uygulanmadı). */
export function isMissingSchemaError(error: RpcError): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist")
  );
}

async function rpcRows<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    if (isMissingSchemaError(error)) throw new InsightFactsUnavailable(name);
    throw new Error(`${name}: ${error.code ?? "hata"}`);
  }
  return (data ?? []) as T[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function loadQuietCustomers(admin: SupabaseClient, tenantId: string, minQuietDays = 14): Promise<QuietCustomerFact[]> {
  const rows = await rpcRows<Record<string, unknown>>(admin, "insight_quiet_valuable_customers", {
    p_tenant_id: tenantId,
    p_min_quiet_days: minQuietDays,
    p_limit: 200,
  });
  return rows.map((r) => ({
    customerId: String(r.customer_id),
    assignedTo: String(r.assigned_to),
    fullName: (r.full_name as string | null) ?? null,
    activeDemands: num(r.active_demands),
    quietDays: num(r.quiet_days),
  }));
}

export async function loadStalledDeals(admin: SupabaseClient, tenantId: string, minIdleDays = 14): Promise<StalledDealFact[]> {
  const rows = await rpcRows<Record<string, unknown>>(admin, "insight_stalled_deals", {
    p_tenant_id: tenantId,
    p_min_idle_days: minIdleDays,
    p_limit: 200,
  });
  return rows.map((r) => ({
    dealId: String(r.deal_id),
    assignedTo: String(r.assigned_to),
    stage: String(r.stage),
    createdAt: String(r.deal_created_at),
    updatedAt: (r.deal_updated_at as string | null) ?? null,
    idleDays: num(r.idle_days),
    offerCount: num(r.offer_count),
    acceptedOffer: Boolean(r.accepted_offer),
    openTaskCount: num(r.open_task_count),
    appointmentCount: num(r.appointment_count),
    dealValue: numOrNull(r.deal_value),
    listPrice: numOrNull(r.list_price),
    propertyTitle: (r.property_title as string | null) ?? null,
    propertyCode: (r.property_code as string | null) ?? null,
  }));
}

export async function loadStaleListings(admin: SupabaseClient, tenantId: string, minDays = 30): Promise<StaleListingFact[]> {
  const rows = await rpcRows<Record<string, unknown>>(admin, "insight_stale_listings", {
    p_tenant_id: tenantId,
    p_min_days: minDays,
    p_limit: 200,
  });
  return rows.map((r) => ({
    propertyId: String(r.property_id),
    assignedTo: String(r.assigned_to),
    propertyCode: (r.property_code as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    listPrice: num(r.list_price),
    daysListed: num(r.days_listed),
    peerCount: num(r.peer_count),
    peerMedian: numOrNull(r.peer_median),
  }));
}

export async function loadDeadlines(admin: SupabaseClient, tenantId: string): Promise<DeadlineFact[]> {
  const rows = await rpcRows<Record<string, unknown>>(admin, "insight_deadlines", {
    p_tenant_id: tenantId,
    p_within_days: 15,
    p_limit: 200,
  });
  return rows.map((r) => ({
    kind: r.deadline_kind === "confirm" ? "confirm" : "authority",
    entityId: String(r.entity_id),
    assignedTo: String(r.assigned_to),
    label: (r.label as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    daysLeft: num(r.days_left),
  }));
}

const ANOMALY_METRICS: readonly AnomalyMetric[] = ["customers", "demands", "appointments"];

export async function loadWeeklySeries(admin: SupabaseClient, tenantId: string): Promise<WeeklySeriesFact[]> {
  const out: WeeklySeriesFact[] = [];
  for (const metric of ANOMALY_METRICS) {
    const rows = await rpcRows<Record<string, unknown>>(admin, "insight_weekly_series", {
      p_tenant_id: tenantId,
      p_metric: metric,
      p_weeks: 12,
    });
    out.push({
      metric,
      points: rows.map((r) => ({ weekStart: String(r.week_start), value: num(r.value), isCurrent: Boolean(r.is_current) })),
    });
  }
  return out;
}
