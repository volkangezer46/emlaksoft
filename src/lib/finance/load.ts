import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { shiftMonthKey, trDayKey, trMonthKey } from "@/lib/clock";
import { computeBudgetRows, sumByCategory, type BudgetRow } from "@/lib/finance/expense-budget";
import {
  addDaysKey,
  buildRecurringSeries,
  isRecurrence,
  type RecurringExpense,
  type RecurringSeries,
} from "@/lib/finance/recurring-expenses";
import {
  computePortalRoi,
  isPortalKey,
  portalKeyFromLeadSource,
  portalKeyFromName,
  ROI_WINDOW_DAYS,
  type PortalExpense,
  type PortalKey,
  type PortalRoiRow,
} from "@/lib/finance/portal-roi";

/**
 * Gider paneli veri yükleyicileri. Hem Giderler sayfası (kullanıcı oturumu, RLS) hem içgörü motoru (admin istemci; çağıran
 * verir) aynı fonksiyonları kullanır: HER sorgu AÇIK tenant_id süzgeçli ve örnek veri (is_sample) dışarıda. Bu dosya
 * istemci OLUŞTURMAZ. Şema (migration 20261008000700) yoksa `available:false` döner / çağıran "etkin değil" der.
 */

type DbError = { code?: string; message?: string } | null | undefined;

/** Sütun/tablo yok (migration uygulanmadı). */
export function isMissingFinanceSchema(error: DbError): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find")
  );
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const lastDayOfMonth = (monthKey: string): string => {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export type BudgetContext = {
  available: boolean;
  monthKey: string;
  prevMonthKey: string;
  monthStart: string;
  monthEnd: string;
  prevMonthStart: string;
  prevMonthEnd: string;
  rows: BudgetRow[];
  /** Bütçe girilmiş kategori sayısı. */
  budgetCount: number;
  /** Kategori → bütçe (düzenleme formu için). */
  budgets: Map<string, number>;
};

export async function loadBudgetContext(db: SupabaseClient, tenantId: string, nowMs: number): Promise<BudgetContext> {
  const monthKey = trMonthKey(nowMs);
  const prevMonthKey = shiftMonthKey(monthKey, -1) ?? monthKey;
  const base: BudgetContext = {
    available: true,
    monthKey,
    prevMonthKey,
    monthStart: `${monthKey}-01`,
    monthEnd: lastDayOfMonth(monthKey),
    prevMonthStart: `${prevMonthKey}-01`,
    prevMonthEnd: lastDayOfMonth(prevMonthKey),
    rows: [],
    budgetCount: 0,
    budgets: new Map(),
  };
  const { data: budgetRows, error } = await db.from("expense_budgets").select("category, monthly_amount").eq("tenant_id", tenantId);
  if (error) {
    if (isMissingFinanceSchema(error)) return { ...base, available: false };
    throw new Error(`expense_budgets: ${error.code ?? "hata"}`);
  }
  const budgets = ((budgetRows ?? []) as { category: string; monthly_amount: number | string }[]).map((b) => ({ category: b.category, monthlyAmount: num(b.monthly_amount) }));
  base.budgetCount = budgets.length;
  base.budgets = new Map(budgets.map((b) => [b.category, b.monthlyAmount]));
  if (budgets.length === 0) return base;

  const { data, error: spentError } = await fetchAllRowsKeepError<{ category: string; amount: number | string; expense_date: string }, { message: string; code?: string }>((from, to) =>
    db
      .from("expenses")
      .select("category, amount, expense_date")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .gte("expense_date", `${prevMonthKey}-01`)
      .lte("expense_date", base.monthEnd)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (spentError) throw new Error(`expenses(budget): ${spentError.code ?? "hata"}`);
  const rows = (data ?? []).map((r) => ({ category: r.category, amount: r.amount, month: String(r.expense_date).slice(0, 7) }));
  const thisMonth = sumByCategory(rows.filter((r) => r.month === monthKey));
  const prevMonth = sumByCategory(rows.filter((r) => r.month === prevMonthKey));
  base.rows = computeBudgetRows(budgets, thisMonth, prevMonth);
  return base;
}

export type RecurringContext = { available: boolean; todayKey: string; series: RecurringSeries[] };

export async function loadRecurringSeries(db: SupabaseClient, tenantId: string, nowMs: number): Promise<RecurringContext> {
  const todayKey = trDayKey(nowMs);
  // Yıllık seri için 13+ ay geriye bakmak gerekir.
  const since = addDaysKey(todayKey, -430);
  const { data, error } = await fetchAllRowsKeepError<
    { id: string; title: string; category: string; amount: number | string; expense_date: string; recurrence: string | null; portal_key: string | null },
    { message: string; code?: string }
  >((from, to) =>
    db
      .from("expenses")
      .select("id, title, category, amount, expense_date, recurrence, portal_key")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .not("recurrence", "is", null)
      .gte("expense_date", since)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) {
    if (isMissingFinanceSchema(error)) return { available: false, todayKey, series: [] };
    throw new Error(`expenses(recurring): ${error.code ?? "hata"}`);
  }
  const rows: RecurringExpense[] = [];
  for (const r of data) {
    if (!isRecurrence(r.recurrence)) continue;
    rows.push({ id: r.id, title: r.title, category: r.category, amount: num(r.amount), date: String(r.expense_date).slice(0, 10), recurrence: r.recurrence, portalKey: r.portal_key });
  }
  return { available: true, todayKey, series: buildRecurringSeries(rows) };
}

export type PortalRoiContext = { available: boolean; windowStart: string; windowEnd: string; rows: PortalRoiRow[] };

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadPortalRoi(db: SupabaseClient, tenantId: string, nowMs: number): Promise<PortalRoiContext> {
  const windowEnd = trDayKey(nowMs);
  const windowStart = addDaysKey(windowEnd, -(ROI_WINDOW_DAYS - 1));
  const empty: PortalRoiContext = { available: true, windowStart, windowEnd, rows: [] };

  // 1) Portala eşlenmiş giderler (yıllık ödemeler pencereyi örtebilir: 13 ay geriye).
  const expenseRes = await fetchAllRowsKeepError<
    { amount: number | string; expense_date: string; recurrence: string | null; portal_key: string | null },
    { message: string; code?: string }
  >((from, to) =>
    db
      .from("expenses")
      .select("amount, expense_date, recurrence, portal_key")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .not("portal_key", "is", null)
      .gte("expense_date", addDaysKey(windowEnd, -400))
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (expenseRes.error) {
    if (isMissingFinanceSchema(expenseRes.error)) return { ...empty, available: false };
    throw new Error(`expenses(portal): ${expenseRes.error.code ?? "hata"}`);
  }
  const expenses: PortalExpense[] = [];
  for (const e of expenseRes.data) {
    if (!isPortalKey(e.portal_key)) continue;
    expenses.push({ portalKey: e.portal_key, amount: num(e.amount), date: String(e.expense_date).slice(0, 10), recurrence: isRecurrence(e.recurrence) ? e.recurrence : null });
  }
  // Gider eşlemesi yoksa maliyet hesaplanamaz: ROI üretilmez (talep sayıları tek başına karar vermez).
  if (expenses.length === 0) return empty;

  const startMs = Date.parse(`${windowStart}T00:00:00+03:00`);
  const startIso = new Date(startMs).toISOString();

  // 2-4) Talepler, kazanılan anlaşmalar ve portal ilanları birbirinden bağımsız: TEK turda (eskiden art arda 3+ tur).
  // 2) Pencerede gelen talepler (müşteri kaydı; kaynak = portal_<anahtar>).
  const leadResP = fetchAllRowsKeepError<{ lead_source: string | null }, { message: string; code?: string }>((from, to) =>
    db
      .from("customers")
      .select("id, lead_source")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .like("lead_source", "portal_%")
      .gte("created_at", startIso)
      .order("id", { ascending: true })
      .range(from, to),
  );
  // 3) Pencerede kazanılan anlaşmalar (müşterisi portal kaynaklı) + komisyonları.
  const dealResP = fetchAllRowsKeepError<{ id: string; customer: Rel<{ lead_source: string | null }> }, { message: string; code?: string }>((from, to) =>
    db
      .from("deals")
      .select("id, customer:customers!deals_customer_id_fkey!inner(lead_source)")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .eq("stage", "won")
      .gte("updated_at", startIso)
      .like("customer.lead_source", "portal_%")
      .order("id", { ascending: true })
      .range(from, to),
  );
  // 4) Portal ilanları: şu an yayında olanlar ve pencerede yayına girenler.
  const listingResP = fetchAllRowsKeepError<
    { portal_name: string | null; status: string; published_at: string | null; created_at: string },
    { message: string; code?: string }
  >((from, to) =>
    db
      .from("portal_listings")
      .select("id, portal_name, status, published_at, created_at")
      .eq("tenant_id", tenantId)
      .or(`status.eq.live,published_at.gte.${startIso},created_at.gte.${startIso}`)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const [leadRes, dealRes, listingRes] = await Promise.all([leadResP, dealResP, listingResP]);
  if (leadRes.error) throw new Error(`customers(portal): ${leadRes.error.code ?? "hata"}`);
  const leads: Partial<Record<PortalKey, number>> = {};
  for (const l of leadRes.data) {
    const key = portalKeyFromLeadSource(l.lead_source);
    if (key) leads[key] = (leads[key] ?? 0) + 1;
  }

  if (dealRes.error) throw new Error(`deals(portal): ${dealRes.error.code ?? "hata"}`);
  const dealKey = new Map<string, PortalKey>();
  for (const d of dealRes.data) {
    const key = portalKeyFromLeadSource(one(d.customer)?.lead_source);
    if (key) dealKey.set(d.id, key);
  }
  const won: Partial<Record<PortalKey, { deals: number; commission: number }>> = {};
  const dealIds = [...dealKey.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < dealIds.length; i += 200) chunks.push(dealIds.slice(i, i + 200));
  const commResults = await Promise.all(
    chunks.map((part) =>
      fetchAllRowsKeepError<{ deal_id: string; gross_amount: number | string; status: string }, { message: string; code?: string }>((from, to) =>
        db
          .from("commissions")
          .select("id, deal_id, gross_amount, status")
          .eq("tenant_id", tenantId)
          .eq("is_sample", false)
          .in("deal_id", part)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ),
  );
  for (const commRes of commResults) {
    if (commRes.error) throw new Error(`commissions(portal): ${commRes.error.code ?? "hata"}`);
    for (const c of commRes.data) {
      if (c.status === "cancelled") continue;
      const key = dealKey.get(c.deal_id);
      if (!key) continue;
      const cur = won[key] ?? { deals: 0, commission: 0 };
      cur.commission += num(c.gross_amount);
      won[key] = cur;
    }
  }
  for (const key of dealKey.values()) {
    const cur = won[key] ?? { deals: 0, commission: 0 };
    cur.deals += 1;
    won[key] = cur;
  }

  if (listingRes.error) throw new Error(`portal_listings(roi): ${listingRes.error.code ?? "hata"}`);
  const liveListings: Partial<Record<PortalKey, number>> = {};
  const listingsInWindow: Partial<Record<PortalKey, number>> = {};
  for (const l of listingRes.data) {
    const key = portalKeyFromName(l.portal_name);
    if (!key) continue;
    if (l.status === "live") liveListings[key] = (liveListings[key] ?? 0) + 1;
    const when = l.published_at ?? l.created_at;
    if (when && Date.parse(when) >= startMs) listingsInWindow[key] = (listingsInWindow[key] ?? 0) + 1;
  }

  return { available: true, windowStart, windowEnd, rows: computePortalRoi({ expenses, leads, won, liveListings, listingsInWindow, windowStart, windowEnd }) };
}
