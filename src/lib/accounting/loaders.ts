import "server-only";

/**
 * Muhasebe veri okuyucuları (SUNUCU). Hepsi çağıran sayfa/route'tan gelen `admin` istemcisiyle çalışır
 * (yetki kapısı ÇAĞIRANDA: requirePlatformModule("billing")); burada yeni service_role üretilmez.
 * Hiçbir hesap burada yapılmaz: ham satırlar `ledger.ts`/`ef-economics.ts` saf fonksiyonlarına verilir.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { EF_RPC } from "@/lib/ef-credits/config";
import { exactArr, exactMrr, priceMapOf, type PlatformReportingAggregate } from "@/lib/reporting/platform";
import { type Period } from "@/lib/accounting/period";
import { classifyInvoiceKind, toLedgerInvoice, type LedgerInvoice, type RawInvoiceRow } from "@/lib/accounting/ledger";
import type { EfUsageRow } from "@/lib/accounting/ef-economics";

type Admin = ReturnType<typeof createAdminClient>;

export const LEDGER_PAGE_SIZE = 1000;
/** Tek dönemde okunacak en çok fatura; aşılırsa `truncated` döner (sessiz kesme YOK, arayüz/CSV uyarır). */
export const LEDGER_MAX_ROWS = 50_000;

const INVOICE_SELECT =
  "id, tenant_id, subscription_id, invoice_no, status, amount_try, tax_try, total_try, currency, due_at, paid_at, created_at, iyzico_payment_id, meta, tenant:tenants(id, name, tax_office, tax_number)";

/** PostgREST `or()` için muhasebe tarihi koşulu: paid_at varsa paid_at, yoksa created_at dönemde. */
export function accountingDateOrFilter(period: Pick<Period, "fromIso" | "toIso">): string | null {
  if (!period.fromIso && !period.toIso) return null;
  const range = (col: string) => {
    const parts: string[] = [];
    if (period.fromIso) parts.push(`${col}.gte.${period.fromIso}`);
    if (period.toIso) parts.push(`${col}.lt.${period.toIso}`);
    return parts.join(",");
  };
  return `and(${range("paid_at")}),and(paid_at.is.null,${range("created_at")})`;
}

type PageMode = "accounting" | "refund";

/** Sayfa sayfa ham fatura satırları (kararlı sıra: created_at desc, id). Üst sınıra kadar. */
export async function* iterateInvoicePages(admin: Admin, period: Pick<Period, "fromIso" | "toIso">, mode: PageMode): AsyncGenerator<RawInvoiceRow[]> {
  let offset = 0;
  while (offset < LEDGER_MAX_ROWS) {
    let q = admin.from("invoices").select(INVOICE_SELECT).order("created_at", { ascending: false }).order("id", { ascending: true });
    if (mode === "accounting") {
      const or = accountingDateOrFilter(period);
      if (or) q = q.or(or);
    } else {
      if (period.fromIso) q = q.gte("meta->refund->>at", period.fromIso);
      if (period.toIso) q = q.lt("meta->refund->>at", period.toIso);
      if (!period.fromIso && !period.toIso) q = q.not("meta->refund", "is", null);
    }
    const { data, error } = await q.range(offset, offset + LEDGER_PAGE_SIZE - 1);
    if (error) throw new Error(`invoices okunamadı: ${error.message}`);
    const rows = (data ?? []) as unknown as RawInvoiceRow[];
    if (rows.length > 0) yield rows;
    if (rows.length < LEDGER_PAGE_SIZE) return;
    offset += LEDGER_PAGE_SIZE;
  }
}

type CouponInfo = { code: string | null; discountKurus: number };

/** Faturalara bağlı kupon kullanımları (şema yoksa/hata varsa boş harita: kupon kolonları boş kalır). */
export async function loadCouponsByInvoice(admin: Admin, invoiceIds: readonly string[]): Promise<{ map: Map<string, CouponInfo>; available: boolean }> {
  const map = new Map<string, CouponInfo>();
  let available = true;
  for (let i = 0; i < invoiceIds.length; i += 100) {
    const chunk = invoiceIds.slice(i, i + 100);
    const { data, error } = await admin
      .from("coupon_redemptions")
      .select("invoice_id, discount_try, coupon:coupons!coupon_redemptions_coupon_id_fkey(code)")
      .in("invoice_id", chunk);
    if (error) {
      available = false;
      break;
    }
    for (const r of data ?? []) {
      const c = Array.isArray(r.coupon) ? r.coupon[0] : r.coupon;
      map.set(String(r.invoice_id), {
        code: (c as { code?: string } | null)?.code ?? null,
        discountKurus: Math.round(Number(r.discount_try ?? 0) * 100),
      });
    }
  }
  return { map, available };
}

export async function enrichPage(admin: Admin, rows: readonly RawInvoiceRow[]): Promise<LedgerInvoice[]> {
  const { map } = await loadCouponsByInvoice(admin, rows.map((r) => r.id));
  return rows.map((r) => toLedgerInvoice(r, map.get(r.id)));
}

export type LedgerLoad = { rows: LedgerInvoice[]; truncated: boolean };

/** Dönemin muhasebe-tarihli faturaları + (istenirse) dönemde iade edilenler; tekilleştirilmiş. */
export async function loadLedger(admin: Admin, period: Pick<Period, "fromIso" | "toIso">, opts: { withRefunds: boolean }): Promise<LedgerLoad> {
  const seen = new Set<string>();
  const rows: LedgerInvoice[] = [];
  let truncated = false;
  const modes: PageMode[] = opts.withRefunds ? ["accounting", "refund"] : ["accounting"];
  for (const mode of modes) {
    for await (const page of iterateInvoicePages(admin, period, mode)) {
      const fresh = page.filter((r) => !seen.has(r.id));
      for (const r of fresh) seen.add(r.id);
      rows.push(...(await enrichPage(admin, fresh)));
      if (seen.size >= LEDGER_MAX_ROWS) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  return { rows, truncated };
}

/** Tüm zamanların AÇIK faturaları (bekleyen/gecikmiş anlık görüntü; taslaklar borç sayılmaz). */
export async function loadOpenInvoices(admin: Admin): Promise<LedgerInvoice[]> {
  const out: LedgerInvoice[] = [];
  let offset = 0;
  while (offset < LEDGER_MAX_ROWS) {
    const { data, error } = await admin
      .from("invoices")
      .select(INVOICE_SELECT)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + LEDGER_PAGE_SIZE - 1);
    if (error) throw new Error(`açık faturalar okunamadı: ${error.message}`);
    const rows = (data ?? []) as unknown as RawInvoiceRow[];
    out.push(...rows.map((r) => toLedgerInvoice(r)));
    if (rows.length < LEDGER_PAGE_SIZE) break;
    offset += LEDGER_PAGE_SIZE;
  }
  return out;
}

export type SubscriptionMovement = {
  /** Dönemde oluşan abonelik kaydı. */
  created: number;
  /** Dönemde iptal edilen (cancelled_at dönemde). */
  cancelled: number;
  /** Dönemde plan ödemesi alan ve daha önce de plan ödemesi olan ofis sayısı; "tüm zamanlar"da null. */
  renewing: number | null;
};

export async function loadSubscriptionMovement(admin: Admin, period: Period, collectedPlanTenantIds: readonly string[]): Promise<SubscriptionMovement> {
  const countIn = async (col: "created_at" | "cancelled_at") => {
    let q = admin.from("subscriptions").select("id", { count: "exact", head: true });
    if (period.fromIso) q = q.gte(col, period.fromIso);
    if (period.toIso) q = q.lt(col, period.toIso);
    if (!period.fromIso && !period.toIso && col === "cancelled_at") q = q.not("cancelled_at", "is", null);
    const { count } = await q;
    return count ?? 0;
  };
  const [created, cancelled] = await Promise.all([countIn("created_at"), countIn("cancelled_at")]);

  let renewing: number | null = null;
  if (period.fromIso) {
    const ids = [...new Set(collectedPlanTenantIds)];
    const earlier = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await admin
        .from("invoices")
        .select("tenant_id, subscription_id, meta")
        .eq("status", "paid")
        .lt("paid_at", period.fromIso)
        .in("tenant_id", ids.slice(i, i + 100));
      for (const r of data ?? []) {
        if (classifyInvoiceKind(r.meta, r.subscription_id as string | null) === "plan") earlier.add(String(r.tenant_id));
      }
    }
    renewing = earlier.size;
  }
  return { created, cancelled, renewing };
}

export type EfUsageLoad = { enabled: boolean; rows: EfUsageRow[]; truncated: boolean };

/** Kesinleşmiş kontör kullanımı (ef_credit_reservations). Tablo yoksa/okunamazsa `enabled:false` (hata atmaz). */
export async function loadEfUsage(admin: Admin, period: Pick<Period, "fromIso" | "toIso">): Promise<EfUsageLoad> {
  const rows: EfUsageRow[] = [];
  let offset = 0;
  while (offset < LEDGER_MAX_ROWS) {
    let q = admin
      .from("ef_credit_reservations")
      .select("item, units")
      .eq("state", "committed")
      .order("settled_at", { ascending: false })
      .order("id", { ascending: true });
    if (period.fromIso) q = q.gte("settled_at", period.fromIso);
    if (period.toIso) q = q.lt("settled_at", period.toIso);
    const { data, error } = await q.range(offset, offset + LEDGER_PAGE_SIZE - 1);
    if (error) return { enabled: false, rows: [], truncated: false };
    const page = (data ?? []) as { item: string; units: number }[];
    rows.push(...page.map((r) => ({ item: String(r.item), units: Number(r.units) })));
    if (page.length < LEDGER_PAGE_SIZE) return { enabled: true, rows, truncated: false };
    offset += LEDGER_PAGE_SIZE;
  }
  return { enabled: true, rows, truncated: true };
}

export type EfBalanceLoad = { enabled: false } | { enabled: true; available: number; reserved: number; grantedTotal: number; committedTotal: number };

/** Ofisin kontör bakiyesi (ef_credit_balance RPC). RPC yoksa/hata verirse etkin değil. */
export async function loadEfBalance(admin: Admin, tenantId: string): Promise<EfBalanceLoad> {
  const { data, error } = await admin.rpc(EF_RPC.balance, { p_tenant: tenantId });
  if (error || !data || typeof data !== "object") return { enabled: false };
  const b = data as Record<string, unknown>;
  return {
    enabled: true,
    available: Number(b.available ?? 0),
    reserved: Number(b.reserved ?? 0),
    grantedTotal: Number(b.granted_total ?? 0),
    committedTotal: Number(b.committed_total ?? 0),
  };
}

/** Tek ofisin faturaları (Ofis 360 finans özeti; en yeni 1000). */
export async function loadTenantInvoices(admin: Admin, tenantId: string): Promise<LedgerInvoice[]> {
  const { data, error } = await admin
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`ofis faturaları okunamadı: ${error.message}`);
  return ((data ?? []) as unknown as RawInvoiceRow[]).map((r) => toLedgerInvoice(r));
}

/** MRR/ARR: mevcut tek hesap (`exactMrr`) yeniden kullanılır; RPC okunamazsa null. */
export async function loadPlatformMrr(admin: Admin, nowMs: number): Promise<{ mrr: number; arr: number } | null> {
  const { data, error } = await admin.rpc("platform_reporting_aggregates", { p_from: null, p_to: null, p_as_of: new Date(nowMs).toISOString() });
  if (error || !data) return null;
  const aggregate = data as unknown as PlatformReportingAggregate;
  const planDefs = await getPlanDefinitions();
  const mrr = exactMrr(aggregate.plan_stats, priceMapOf(planDefs));
  return { mrr, arr: exactArr(mrr) };
}
