import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetEndMonth, type BudgetDistribution, type BudgetLine, type BudgetStatus } from "./budget";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { nextMonthFirst } from "./load";

/**
 * İşletme projesi okuyucuları (RLS'li kullanıcı istemcisi; her sorgu AÇIK tenant_id süzgeçli). Tablo yoksa (migration uygulanmamış)
 * `available:false` döner, fırlatmaz.
 */

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const day = (v: unknown): string => String(v ?? "").slice(0, 10);

export type BudgetRow = {
  id: string;
  buildingId: string;
  title: string;
  periodStart: string;
  months: number;
  distribution: BudgetDistribution;
  lines: BudgetLine[];
  total: number;
  status: BudgetStatus;
  decisionDate: string | null;
  decisionNo: string | null;
  decisionNote: string | null;
  approvedAt: string | null;
};

type RawBudget = {
  id: string; building_id: string; title: string; period_start: string; months: number; distribution: BudgetDistribution; lines: unknown;
  total_amount: number | string; status: BudgetStatus; decision_date: string | null; decision_no: string | null; decision_note: string | null; approved_at: string | null;
};

export const BUDGET_COLS = "id, building_id, title, period_start, months, distribution, lines, total_amount, status, decision_date, decision_no, decision_note, approved_at";

export function mapBudget(b: RawBudget): BudgetRow {
  const lines = (Array.isArray(b.lines) ? b.lines : []).flatMap((l): BudgetLine[] => {
    if (!l || typeof l !== "object") return [];
    const r = l as Record<string, unknown>;
    return [{ category: typeof r.category === "string" ? r.category : null, label: String(r.label ?? ""), amount: num(r.amount) }];
  });
  return {
    id: b.id, buildingId: b.building_id, title: b.title, periodStart: day(b.period_start), months: Number(b.months) || 12, distribution: b.distribution,
    lines, total: num(b.total_amount), status: b.status, decisionDate: b.decision_date ? day(b.decision_date) : null, decisionNo: b.decision_no,
    decisionNote: b.decision_note, approvedAt: b.approved_at,
  };
}

export async function loadBuildingBudgets(
  db: SupabaseClient,
  input: { tenantId: string; buildingId: string },
): Promise<{ available: boolean; budgets: BudgetRow[] }> {
  const res = await db
    .from("building_budgets")
    .select(BUDGET_COLS)
    .eq("tenant_id", input.tenantId)
    .eq("building_id", input.buildingId)
    .order("period_start", { ascending: false })
    .limit(20);
  if (res.error) return { available: false, budgets: [] };
  return { available: true, budgets: ((res.data ?? []) as unknown as RawBudget[]).map(mapBudget) };
}

export type BudgetReportData = {
  /** Bütçe penceresindeki ortak gider paylaştırmaları (gerçekleşen). */
  actuals: { id: string; category: string | null; amount: number; period: string; title: string }[];
  /** Bütçeden üretilen aylık avans tahakkukları. */
  advanceBatches: { id: string; period: string; total: number }[];
  advanceCharges: { amount: number; paid: number }[];
};

/** Bütçe/gerçekleşen ve avans tahsilatı için okuma (iptal edilmemiş kayıtlar). */
export async function loadBudgetReport(db: SupabaseClient, input: { tenantId: string; budget: BudgetRow }): Promise<BudgetReportData> {
  const { tenantId, budget } = input;
  const end = nextMonthFirst(budgetEndMonth(budget.periodStart, budget.months));
  const [actRes, advRes] = await Promise.all([
    db.from("building_charge_batches").select("id, category, total_amount, period, title")
      .eq("tenant_id", tenantId).eq("building_id", budget.buildingId).eq("kind", "expense_share").is("voided_at", null)
      .gte("period", budget.periodStart).lt("period", end).order("period", { ascending: true }).limit(1000),
    db.from("building_charge_batches").select("id, period, total_amount")
      .eq("tenant_id", tenantId).eq("budget_id", budget.id).is("voided_at", null).order("period", { ascending: true }).limit(60),
  ]);
  const actuals = actRes.error
    ? []
    : ((actRes.data ?? []) as { id: string; category: string | null; total_amount: number | string; period: string; title: string }[]).map((r) => ({
      id: r.id, category: r.category, amount: num(r.total_amount), period: day(r.period), title: r.title,
    }));
  const advanceBatches = advRes.error ? [] : ((advRes.data ?? []) as { id: string; period: string; total_amount: number | string }[]).map((r) => ({ id: r.id, period: day(r.period), total: num(r.total_amount) }));
  let advanceCharges: BudgetReportData["advanceCharges"] = [];
  if (advanceBatches.length > 0) {
    const chRes = await fetchAllRows<{ amount: number | string; paid_amount: number | string }>((from, to) =>
      db.from("building_charges").select("id, amount, paid_amount")
        .eq("tenant_id", tenantId).in("batch_id", advanceBatches.map((b) => b.id)).is("voided_at", null)
        .order("id", { ascending: true }).range(from, to), 1000, 60);
    if (!chRes.error) advanceCharges = chRes.data.map((c) => ({ amount: num(c.amount), paid: num(c.paid_amount) }));
  }
  return { actuals, advanceBatches, advanceCharges };
}

/** Yazdırma sayfası: tek bütçe + bina adı (RLS'li). */
export async function loadBudgetById(
  db: SupabaseClient,
  input: { tenantId: string; budgetId: string },
): Promise<{ budget: BudgetRow; building: { id: string; name: string; address: string | null; city: string | null; district: string | null; due_day: number } } | null> {
  const res = await db
    .from("building_budgets")
    .select(`${BUDGET_COLS}, building:buildings!building_budgets_building_tenant_fkey(id, name, address, city, district, due_day)`)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.budgetId)
    .maybeSingle();
  if (res.error || !res.data) return null;
  const raw = res.data as unknown as RawBudget & { building: { id: string; name: string; address: string | null; city: string | null; district: string | null; due_day: number } | { id: string; name: string; address: string | null; city: string | null; district: string | null; due_day: number }[] | null };
  const b = Array.isArray(raw.building) ? raw.building[0] : raw.building;
  if (!b) return null;
  return { budget: mapBudget(raw), building: b };
}
