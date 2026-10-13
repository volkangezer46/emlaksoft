import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOverrideActive, overrideFromRow, type EntitlementOverride } from "@/lib/billing/entitlements/overrides";
import {
  buildPaymentAttempts,
  cancelReasonLabel,
  type AttemptCaptureRow,
  type AttemptInvoiceRow,
  type PaymentAttempt,
} from "@/lib/billing/subscription-ops-core";

/**
 * ABONELİK OPERASYON KONSOLU: SUNUCU OKUYUCULARI (Ofis 360 > Abonelik). Admin istemcisi çağıran sayfadan/action'dan
 * gelir (yeni service_role kullanımı yok); her sorgu `tenant_id` ile süzülür. 20261013004000 uygulanmadıysa yeni
 * sütunlar/tablo okunamaz: okuyucu eski sütunlara düşer ve `schema` bayrağı ekranın "kurulum bekliyor" demesini sağlar.
 */

export const SUB_BASE_COLUMNS =
  "id, tenant_id, plan, status, billing_cycle, amount_try, current_period_start, current_period_end, trial_ends_at, cancelled_at, " +
  "cancel_at_period_end, cancel_requested_at, cancel_reason, pause_started_at, pause_ends_at, pause_last_started_at, " +
  "pending_plan, pending_plan_effective_at, price_lock_try, price_lock_campaign, seat_price_lock_base_try, seat_price_lock_tiers, extra_seats";
export const SUB_OPS_COLUMNS = "commitment_end_at, cancel_reason_code, cancel_note";

export type OpsSubRow = {
  id: string;
  tenant_id: string;
  plan: string;
  status: string;
  billing_cycle: string;
  amount_try: number | string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancelled_at: string | null;
  cancel_at_period_end: boolean | null;
  cancel_requested_at: string | null;
  cancel_reason: string | null;
  pause_started_at: string | null;
  pause_ends_at: string | null;
  pause_last_started_at: string | null;
  pending_plan: string | null;
  pending_plan_effective_at: string | null;
  price_lock_try: number | string | null;
  price_lock_campaign: string | null;
  seat_price_lock_base_try: number | string | null;
  seat_price_lock_tiers: unknown;
  extra_seats: number | null;
  commitment_end_at?: string | null;
  cancel_reason_code?: string | null;
  cancel_note?: string | null;
};

/** Abonelik satırı: önce yeni sütunlarla, yoksa (migration bekliyor) eski sütunlarla. */
export async function readOpsSubscription(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ row: OpsSubRow | null; opsColumns: boolean; error: boolean }> {
  const full = await admin.from("subscriptions").select(`${SUB_BASE_COLUMNS}, ${SUB_OPS_COLUMNS}`).eq("tenant_id", tenantId).maybeSingle();
  if (!full.error) return { row: (full.data as unknown as OpsSubRow | null) ?? null, opsColumns: true, error: false };
  const base = await admin.from("subscriptions").select(SUB_BASE_COLUMNS).eq("tenant_id", tenantId).maybeSingle();
  if (base.error) return { row: null, opsColumns: false, error: true };
  return { row: (base.data as unknown as OpsSubRow | null) ?? null, opsColumns: false, error: false };
}

export type OverrideView = EntitlementOverride & {
  reason: string;
  createdBy: string | null;
  revokeReason: string | null;
  /** Sunucu saatiyle: geri alınmamış ve süresi dolmamış. */
  active: boolean;
};

/** İstisna listesi (geri alınanlar dahil, en yeni önce; en çok 50). Tablo yoksa `ready: false`. */
export async function readEntitlementOverrides(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<{ ready: boolean; rows: OverrideView[] }> {
  const { data, error } = await admin
    .from("tenant_entitlement_overrides")
    .select("id, key, delta, value, expires_at, revoked_at, created_at, reason, revoke_reason, created_by, staff:platform_staff!tenant_entitlement_overrides_created_by_fkey(full_name, email)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ready: false, rows: [] };
  const rows: OverrideView[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const base = overrideFromRow(r);
    if (!base) continue;
    const staff = (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { full_name?: string | null; email?: string | null } | null;
    rows.push({
      ...base,
      reason: String(r.reason ?? ""),
      revokeReason: typeof r.revoke_reason === "string" ? r.revoke_reason : null,
      createdBy: staff?.full_name || staff?.email || null,
      active: isOverrideActive(base, nowMs),
    });
  }
  return { ready: true, rows };
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};

/** İstemci konsoluna giden sade abonelik görünümü (ISO tarih metinleri; biçimleme istemcide). */
export type SubscriptionOpsView = {
  exists: boolean;
  plan: string;
  status: string;
  cycle: "monthly" | "yearly";
  amountTry: number | null;
  periodStartIso: string | null;
  periodEndIso: string | null;
  trialEndsIso: string | null;
  cancelAtPeriodEnd: boolean;
  cancelRequestedIso: string | null;
  cancelReason: string | null;
  cancelReasonLabel: string | null;
  cancelNote: string | null;
  pauseStartedIso: string | null;
  pauseEndsIso: string | null;
  pendingPlan: string | null;
  pendingPlanIso: string | null;
  priceLockTry: number | null;
  priceLockCampaign: string | null;
  seatBaseLockTry: number | null;
  extraSeats: number;
  commitmentEndIso: string | null;
};

export function toOpsView(row: OpsSubRow | null): SubscriptionOpsView {
  return {
    exists: Boolean(row),
    plan: row?.plan ?? "office",
    status: row?.status ?? "trialing",
    cycle: row?.billing_cycle === "yearly" ? "yearly" : "monthly",
    amountTry: num(row?.amount_try),
    periodStartIso: row?.current_period_start ?? null,
    periodEndIso: row?.current_period_end ?? null,
    trialEndsIso: row?.trial_ends_at ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end === true,
    cancelRequestedIso: row?.cancel_requested_at ?? null,
    cancelReason: row?.cancel_reason ?? null,
    cancelReasonLabel: cancelReasonLabel(row?.cancel_reason_code ?? null),
    cancelNote: row?.cancel_note ?? null,
    pauseStartedIso: row?.pause_started_at ?? null,
    pauseEndsIso: row?.pause_ends_at ?? null,
    pendingPlan: row?.pending_plan ?? null,
    pendingPlanIso: row?.pending_plan_effective_at ?? null,
    priceLockTry: num(row?.price_lock_try),
    priceLockCampaign: row?.price_lock_campaign ?? null,
    seatBaseLockTry: num(row?.seat_price_lock_base_try),
    extraSeats: Math.max(0, Math.floor(num(row?.extra_seats) ?? 0)),
    commitmentEndIso: row?.commitment_end_at ?? null,
  };
}

export type SubscriptionOpsData = {
  sub: SubscriptionOpsView;
  schema: { opsColumns: boolean; overrides: boolean };
  overrides: OverrideView[];
};

export async function loadSubscriptionOps(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<SubscriptionOpsData> {
  const [sub, overrides] = await Promise.all([readOpsSubscription(admin, tenantId), readEntitlementOverrides(admin, tenantId, nowMs)]);
  return {
    sub: toOpsView(sub.row),
    schema: { opsColumns: sub.opsColumns, overrides: overrides.ready },
    overrides: overrides.rows,
  };
}

// ---------------------------------------------------------------------------
// Ödeme profili
// ---------------------------------------------------------------------------

export type CardView = { id: string; brand: string | null; family: string | null; lastFour: string | null; isDefault: boolean; createdIso: string };

export type PaymentProfileData = {
  ready: boolean;
  autoRenewEnabled: boolean;
  autoRenewConsentIso: string | null;
  autoRenewCardId: string | null;
  cards: CardView[];
  attempts: PaymentAttempt[];
  /** checkout_error sütunu okunabildi (yoksa hata metni yalnız durumdan türetilir). */
  errorColumn: boolean;
};

const ATTEMPT_BASE = "id, invoice_no, status, checkout_status, total_try, created_at, paid_at, meta";

/**
 * Kayıtlı kart (MASKELİ: marka/aile/son 4 hane; kart anahtarı ve BIN ASLA okunmaz), otomatik yenileme rızası ve
 * son 10 tahsil denemesi (ödeme oturumu açılmış faturalar + mutabakat kayıtları).
 */
export async function loadPaymentProfile(admin: SupabaseClient, tenantId: string): Promise<PaymentProfileData> {
  const invoicesWithError = () =>
    admin
      .from("invoices")
      .select(`${ATTEMPT_BASE}, checkout_error`)
      .eq("tenant_id", tenantId)
      .not("checkout_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
  const [profileRes, cardsRes, invRes, capRes] = await Promise.all([
    admin
      .from("tenant_payment_profiles")
      .select("auto_renew_enabled, auto_renew_card_id, auto_renew_consent_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("payment_cards")
      .select("id, brand, card_family, last_four, is_default, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
    invoicesWithError(),
    admin
      .from("billing_payment_captures")
      .select("id, invoice_id, status, attempt_count, last_error_code, captured_at, amount_try")
      .eq("tenant_id", tenantId)
      .order("captured_at", { ascending: false })
      .limit(20),
  ]);
  let errorColumn = true;
  let invoices = invRes.data as unknown as AttemptInvoiceRow[] | null;
  if (invRes.error) {
    errorColumn = false;
    const fallback = await admin
      .from("invoices")
      .select(ATTEMPT_BASE)
      .eq("tenant_id", tenantId)
      .not("checkout_status", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    invoices = fallback.error ? [] : (fallback.data as unknown as AttemptInvoiceRow[]);
  }
  const profile = profileRes.error ? null : (profileRes.data as { auto_renew_enabled?: boolean; auto_renew_card_id?: string | null; auto_renew_consent_at?: string | null } | null);
  const cards = cardsRes.error
    ? []
    : ((cardsRes.data ?? []) as { id: string; brand: string | null; card_family: string | null; last_four: string | null; is_default: boolean | null; created_at: string }[]).map((c) => ({
        id: c.id,
        brand: c.brand,
        family: c.card_family,
        lastFour: c.last_four && /^[0-9]{4}$/.test(c.last_four) ? c.last_four : null,
        isDefault: c.is_default === true,
        createdIso: c.created_at,
      }));
  return {
    ready: !profileRes.error && !cardsRes.error,
    autoRenewEnabled: profile?.auto_renew_enabled === true,
    autoRenewConsentIso: profile?.auto_renew_consent_at ?? null,
    autoRenewCardId: profile?.auto_renew_card_id ?? null,
    cards,
    attempts: buildPaymentAttempts(invoices ?? [], capRes.error ? [] : ((capRes.data ?? []) as AttemptCaptureRow[]), 10),
    errorColumn,
  };
}
