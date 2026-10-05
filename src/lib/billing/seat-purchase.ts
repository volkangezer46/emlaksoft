import { randomBytes } from "node:crypto";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCycle, PlanId, SeatTier } from "@/lib/billing/plans";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";
import { invoiceAmountsTry } from "@/lib/billing/fulfillment";
import { now } from "@/lib/clock";
import { getPlanDefinition, getSeatSettings } from "@/lib/billing/plan-definitions";
import { seatUtilization } from "@/lib/billing/seat-pricing";
import { warnRatioOf } from "@/lib/billing/seat-settings";

/**
 * EK KULLANICI (KOLTUK) SATIN ALMA: SUNUCU KATMANI.
 *
 * Şema/migration hazır olana dek her şey KAPALIDIR (zarif düşüş):
 *  - Görüntüleme: subscriptions.extra_seats sütunu + effective_seat_limit() fonksiyonu varsa açılır.
 *  - Satış (para tahsil eden yol): ayrıca `seat_purchase_ready()` RPC'si true dönmelidir. Bu RPC, ödeme
 *    başarılı olunca `meta.kind = 'extra_seats'` faturasını işleyen (extra_seats'i atomik artıran, dönem
 *    sonunu DEĞİŞTİRMEYEN) fulfill tarafının var olduğunu bildirir. RPC yoksa/false ise action reddeder;
 *    böylece koltuk için tahsilat yapılıp koltuğun verilmemesi mümkün olmaz.
 *
 * Fatura meta sözleşmesi (fulfill SQL'inin okuyacağı): { kind: 'extra_seats', conversationId, plan, cycle,
 *   source: 'checkout', fromExtraSeats, toExtraSeats, targetTotalSeats, chargeNetTry, quotedPeriodTry }.
 */

export const SEAT_READY_RPC = "seat_purchase_ready";

export type SeatSupport = {
  /** subscriptions.extra_seats sütunu var. */
  extraSeatsColumn: boolean;
  /** effective_seat_limit(uuid) fonksiyonu var. */
  effectiveLimitFn: boolean;
  /** seat_price_lock_base_try / seat_price_lock_tiers sütunları var. */
  priceLock: boolean;
  /** Koltuk satışı için fulfill hazır (seat_purchase_ready() = true). */
  purchaseReady: boolean;
  /** Panel gösterilir (görüntüleme). */
  displayEnabled: boolean;
};

const cachedSeatSupport = () => unstable_cache(
  async (): Promise<SeatSupport> => {
    const out: SeatSupport = {
      extraSeatsColumn: false,
      effectiveLimitFn: false,
      priceLock: false,
      purchaseReady: false,
      displayEnabled: false,
    };
    try {
      const admin = createAdminClient();
      const [col, fn, lock, ready] = await Promise.all([
        admin.from("subscriptions").select("extra_seats").limit(1),
        admin.rpc("effective_seat_limit", { p_tenant_id: "00000000-0000-0000-0000-000000000000" }),
        admin.from("subscriptions").select("seat_price_lock_base_try, seat_price_lock_tiers").limit(1),
        admin.rpc(SEAT_READY_RPC),
      ]);
      out.extraSeatsColumn = !col.error;
      out.effectiveLimitFn = !fn.error;
      out.priceLock = !lock.error;
      out.displayEnabled = out.extraSeatsColumn && out.effectiveLimitFn;
      out.purchaseReady = out.displayEnabled && !ready.error && ready.data === true;
    } catch (e) {
      console.error("getSeatSupport", e);
    }
    return out;
  },
  ["seat-support-v1"],
  { revalidate: 60 },
);

/** Önbellek ilk çağrıda kurulur (modül yüklenirken next/cache gerekmez). */
export async function getSeatSupport(): Promise<SeatSupport> {
  return cachedSeatSupport()();
}

export type SeatState = {
  planId: string;
  status: string | null;
  subscriptionId: string | null;
  cycle: BillingCycle;
  extraSeats: number;
  lockedBaseMonthlyTry: number | null;
  lockedTiers: SeatTier[] | null;
  periodStartMs: number | null;
  periodEndMs: number | null;
};

export function parseSeatTiers(raw: unknown): SeatTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SeatTier[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return null;
    const r = t as Record<string, unknown>;
    const from = Number(r.fromSeat);
    const to = r.toSeat === null || r.toSeat === undefined ? null : Number(r.toSeat);
    const price = Number(r.monthlyTry);
    if (!Number.isInteger(from) || from < 1 || !Number.isFinite(price) || price <= 0) return null;
    if (to !== null && (!Number.isInteger(to) || to < from)) return null;
    out.push({ fromSeat: from, toSeat: to, monthlyTry: price });
  }
  return out;
}

function ms(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Aboneliğin koltuk durumu (RLS'li istemciyle, kendi ofisi). Şema yoksa/abonelik yoksa null. */
export async function loadSeatState(
  supabase: SupabaseClient,
  tenantId: string,
  support: SeatSupport,
): Promise<SeatState | null> {
  if (!support.displayEnabled) return null;
  const cols = [
    "id",
    "plan",
    "status",
    "billing_cycle",
    "current_period_start",
    "current_period_end",
    "extra_seats",
    ...(support.priceLock ? ["seat_price_lock_base_try", "seat_price_lock_tiers"] : []),
  ].join(", ");
  const { data, error } = await supabase.from("subscriptions").select(cols).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  const lockBase = Number(row.seat_price_lock_base_try);
  return {
    planId: String(row.plan ?? "office"),
    status: typeof row.status === "string" ? row.status : null,
    subscriptionId: typeof row.id === "string" ? row.id : null,
    cycle: row.billing_cycle === "yearly" ? "yearly" : "monthly",
    extraSeats: Math.max(0, Math.floor(Number(row.extra_seats ?? 0)) || 0),
    lockedBaseMonthlyTry: Number.isFinite(lockBase) && lockBase > 0 ? lockBase : null,
    lockedTiers: parseSeatTiers(row.seat_price_lock_tiers),
    periodStartMs: ms(row.current_period_start),
    periodEndMs: ms(row.current_period_end),
  };
}

/**
 * Satın alınmış ek kullanıcı sayısı (sunucu doğrulaması için, admin client). Sütun yoksa/hata varsa 0:
 * etkin limit = plan limiti (eski davranış).
 */
export async function getExtraSeats(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  try {
    const { data, error } = await admin.from("subscriptions").select("extra_seats").eq("tenant_id", tenantId).maybeSingle();
    if (error || !data) return 0;
    const n = Number((data as { extra_seats?: unknown }).extra_seats ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** Koltuk satın alma faturası taslağı (meta.kind = 'extra_seats'); tahsilat tutarı sunucuda hesaplanmıştır. */
export async function createSeatInvoice(input: {
  tenantId: string;
  subscriptionId: string | null;
  plan: PlanId;
  cycle: BillingCycle;
  conversationId: string;
  chargeNetTry: number;
  fromExtraSeats: number;
  toExtraSeats: number;
  targetTotalSeats: number;
  quotedPeriodTry: number;
}): Promise<{ invoiceId: string; totalTry: number }> {
  const admin = createAdminClient();
  const amounts = invoiceAmountsTry(input.chargeNetTry);
  const expiresAt = new Date(now() + 2 * 60 * 60 * 1000);
  const { data, error } = await admin
    .from("invoices")
    .insert({
      tenant_id: input.tenantId,
      subscription_id: input.subscriptionId,
      invoice_no: `ES-SEAT-${input.tenantId.replace(/-/g, "").slice(0, 6).toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`,
      status: "draft",
      checkout_status: "pending_checkout",
      checkout_expires_at: expiresAt.toISOString(),
      amount_try: amounts.amountTry,
      tax_try: amounts.taxTry,
      total_try: amounts.totalTry,
      currency: IYZICO_CURRENCY,
      period_start: null,
      period_end: null,
      due_at: null,
      meta: {
        kind: "extra_seats",
        conversationId: input.conversationId,
        plan: input.plan,
        cycle: input.cycle,
        source: "checkout",
        fromExtraSeats: input.fromExtraSeats,
        toExtraSeats: input.toExtraSeats,
        targetTotalSeats: input.targetTotalSeats,
        chargeNetTry: input.chargeNetTry,
        quotedPeriodTry: input.quotedPeriodTry,
      },
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createSeatInvoice", error);
    throw new Error("Koltuk faturası oluşturulamadı.");
  }
  return { invoiceId: data.id as string, totalTry: amounts.totalTry };
}

export type SeatUsageSummary = {
  used: number;
  included: number;
  extra: number;
  limit: number;
  ratio: number;
  level: "ok" | "warn80" | "full";
  warnPercent: number;
};

/**
 * Koltuk doluluğu: kullanılan (aktif profil) / (dahil + satın alınmış ek). Eşik admin ayarından (varsayılan %80).
 * RLS'li istemciyle çalışır; ek sütunu yoksa ek = 0 (plan limiti).
 */
export async function loadSeatUsageSummary(
  supabase: SupabaseClient,
  tenantId: string,
  plan: string,
): Promise<SeatUsageSummary | null> {
  try {
    const [def, settings, extra, head] = await Promise.all([
      getPlanDefinition(plan),
      getSeatSettings(),
      getExtraSeats(supabase, tenantId),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);
    if (head.error || head.count == null) return null;
    const included = def.limits.seats;
    const u = seatUtilization(head.count, included, extra, warnRatioOf(settings));
    return {
      used: head.count,
      included,
      extra,
      limit: included + extra,
      ratio: u.ratio,
      level: u.level,
      warnPercent: settings.warnPercent,
    };
  } catch (e) {
    console.error("loadSeatUsageSummary", e);
    return null;
  }
}
