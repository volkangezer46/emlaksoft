import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingCycle } from "@/lib/billing/plans";
import { clampPauseMaxDays, pauseViewOf, type PauseView } from "@/lib/billing/pause-core";
import { pickPaidCapNetTry, type PaidInvoiceRow } from "@/lib/billing/plan-change-paid-cap";
import { getSetting } from "@/lib/settings/read";

/**
 * ORANSAL PAKET DEĞİŞİKLİĞİ + DURAKLATMA: SUNUCU OKUYUCULARI.
 *
 * Her şey VARSAYILAN KAPALI bayrakların (Ayar Kayıt Defteri) ve şema hazırlığının (getPlanSupport probe'ları) arkasındadır:
 *  - `billing.plan_change_proration_enabled`  oransal yükseltme + planlı düşürme
 *  - `billing.pause_enabled` / `billing.pause_max_days`  duraklatma
 * Şema yokken okuyucular null/false döner; para tahsil eden ya da abonelik yazan hiçbir yol açılmaz.
 */

export async function isPlanChangeEnabled(): Promise<boolean> {
  try {
    return (await getSetting<boolean>("billing.plan_change_proration_enabled")) === true;
  } catch {
    return false;
  }
}

export async function isPauseEnabled(): Promise<boolean> {
  try {
    return (await getSetting<boolean>("billing.pause_enabled")) === true;
  } catch {
    return false;
  }
}

export async function getPauseMaxDays(): Promise<number> {
  try {
    return clampPauseMaxDays(await getSetting<number>("billing.pause_max_days"));
  } catch {
    return clampPauseMaxDays(undefined);
  }
}

export type PlanChangeState = {
  subscriptionId: string;
  planId: string;
  status: string | null;
  cycle: BillingCycle;
  periodStartMs: number | null;
  periodEndMs: number | null;
  /** Founders vb. kilitli aylık fiyat. */
  lockedMonthlyTry: number | null;
  cancelAtPeriodEnd: boolean;
  /** Planlı düşürme (dönem sonunda uygulanır). */
  pendingPlan: string | null;
  pendingPlanEffectiveMs: number | null;
  pause: PauseView;
  /** Son duraklatmanın başlangıcı (yıllık sınır). */
  lastPauseStartedMs: number | null;
};

function ms(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Aboneliğin plan-değişikliği/duraklatma durumu (RLS'li istemciyle, kendi ofisi). Yeni sütunlar yoksa (migration
 * uygulanmadı) sorgu hata verir ve null döner: özellik tümüyle gizli kalır.
 */
export async function loadPlanChangeState(supabase: SupabaseClient, tenantId: string): Promise<PlanChangeState | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, plan, status, billing_cycle, current_period_start, current_period_end, price_lock_try, cancel_at_period_end, " +
        "pending_plan, pending_plan_effective_at, pause_started_at, pause_ends_at, pause_last_started_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  const lock = Number(row.price_lock_try);
  return {
    subscriptionId: String(row.id),
    planId: String(row.plan ?? "office"),
    status: typeof row.status === "string" ? row.status : null,
    cycle: row.billing_cycle === "yearly" ? "yearly" : "monthly",
    periodStartMs: ms(row.current_period_start),
    periodEndMs: ms(row.current_period_end),
    lockedMonthlyTry: Number.isFinite(lock) && lock > 0 ? lock : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    pendingPlan: typeof row.pending_plan === "string" ? row.pending_plan : null,
    pendingPlanEffectiveMs: ms(row.pending_plan_effective_at),
    pause: pauseViewOf({
      pause_started_at: typeof row.pause_started_at === "string" ? row.pause_started_at : null,
      pause_ends_at: typeof row.pause_ends_at === "string" ? row.pause_ends_at : null,
    }),
    lastPauseStartedMs: ms(row.pause_last_started_at),
  };
}

/**
 * Kredi tavanı: son ödenen DÜZ yenileme faturasının net tutarı (yoksa/yükseltme faturasıysa null = liste fiyatı).
 * Kupon/indirimle liste fiyatından az ödenmiş dönemde fazladan kredi verilmesini engeller.
 */
export async function loadPaidCapNetTry(supabase: SupabaseClient, tenantId: string, subscriptionId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("amount_try, paid_at, meta")
    .eq("tenant_id", tenantId)
    .eq("subscription_id", subscriptionId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(8);
  if (error) return null;
  return pickPaidCapNetTry((data ?? []) as PaidInvoiceRow[]);
}
