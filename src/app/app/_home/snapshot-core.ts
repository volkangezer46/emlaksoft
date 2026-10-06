import type { InsightDbRow } from "@/lib/insights/readable";
import type { InsightStateCounts } from "@/lib/insights/read";
import { INSIGHT_STATES } from "@/lib/insights/types";

/**
 * Ana ekran anlık görüntü RPC'lerinin (get_tasks_snapshot / get_metrics_snapshot / get_insights_snapshot) SAF tarafı:
 * ham JSON → tipli veri; dönem türetme. DB/React yok (vitest kapsamında).
 *
 * Kural: şekil bozuksa `null` (çağıran mevcut sorgulara düşer; yarım veri ile sahte sıfır üretilmez).
 * Örnek veri kararı (`sampleIncluded`) kodun kendi kararıyla (ctx.sample.include) eşit değilse çağıran sonucu kullanmaz.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};
const count = (v: unknown): number => Math.max(0, Math.trunc(num(v)));
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/* ------------------------------------ Görevler ------------------------------------ */

export type TaskOpenRow = { id: string; title: string | null; due_at: string | null; priority: string | null };
export type TasksSnapshotScope = { dueToday: number; overdue: number; open: TaskOpenRow[] };
export type TasksSnapshot = { sampleIncluded: boolean; mine: TasksSnapshotScope; office: TasksSnapshotScope };

function parseTaskScope(raw: unknown): TasksSnapshotScope | null {
  if (!isObj(raw)) return null;
  const open: TaskOpenRow[] = [];
  for (const r of Array.isArray(raw.open) ? raw.open : []) {
    if (!isObj(r) || typeof r.id !== "string") continue;
    open.push({ id: r.id, title: strOrNull(r.title), due_at: strOrNull(r.due_at), priority: strOrNull(r.priority) });
  }
  return { dueToday: count(raw.due_today), overdue: count(raw.overdue), open };
}

export function parseTasksSnapshot(raw: unknown): TasksSnapshot | null {
  if (!isObj(raw) || typeof raw.sample_included !== "boolean") return null;
  const mine = parseTaskScope(raw.mine);
  const office = parseTaskScope(raw.office);
  if (!mine || !office) return null;
  return { sampleIncluded: raw.sample_included, mine, office };
}

/* ------------------------------------ Metrikler ------------------------------------ */

export type PeriodCounts = { customers: number; customersPrev: number; demands: number; demandsPrev: number };
export type ExpiringAuthorityRow = { id: string; property_code: string | null; title: string | null; authority_expires_at: string };

export type MetricsSnapshot = {
  sampleIncluded: boolean;
  kpi: {
    customerCount: number;
    propertyCount: number;
    callsToday: number;
    callsYesterday: number;
    customersThisMonth: number;
    customersPrevMonth: number;
    callDates: string[];
    customerDates: string[];
  };
  demands: { new: number; active: number; matched: number };
  period: { p7: PeriodCounts; p30: PeriodCounts; p90: PeriodCounts; customerDates90: string[]; demandDates90: string[] };
  decisions: { approvalsPending: number; lostThisMonth: number; overdueRent: number; passiveDays: number; passiveAdvisors: number };
  expiringAuthority: { mine: ExpiringAuthorityRow[]; office: ExpiringAuthorityRow[] };
};

/** RPC'deki tarih serisi tavanı (SQL `limit 500` ile birebir); tavana çarpan seri eksik olabilir. */
export const SNAPSHOT_SERIES_LIMIT = 500;

function parsePeriodCounts(raw: unknown): PeriodCounts | null {
  if (!isObj(raw)) return null;
  return { customers: count(raw.customers), customersPrev: count(raw.customers_prev), demands: count(raw.demands), demandsPrev: count(raw.demands_prev) };
}

function parseAuthorityRows(raw: unknown): ExpiringAuthorityRow[] {
  const out: ExpiringAuthorityRow[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.authorization_end !== "string") continue;
    out.push({ id: r.id, property_code: strOrNull(r.property_code), title: strOrNull(r.title), authority_expires_at: r.authorization_end });
  }
  return out;
}

export function parseMetricsSnapshot(raw: unknown): MetricsSnapshot | null {
  if (!isObj(raw) || typeof raw.sample_included !== "boolean") return null;
  const { kpi, demands, period, decisions, expiring_authority: authority } = raw;
  if (!isObj(kpi) || !isObj(demands) || !isObj(period) || !isObj(decisions) || !isObj(authority)) return null;
  const p7 = parsePeriodCounts(period.p7);
  const p30 = parsePeriodCounts(period.p30);
  const p90 = parsePeriodCounts(period.p90);
  if (!p7 || !p30 || !p90) return null;
  return {
    sampleIncluded: raw.sample_included,
    kpi: {
      customerCount: count(kpi.customer_count),
      propertyCount: count(kpi.property_count),
      callsToday: count(kpi.calls_today),
      callsYesterday: count(kpi.calls_yesterday),
      customersThisMonth: count(kpi.customers_this_month),
      customersPrevMonth: count(kpi.customers_prev_month),
      callDates: strings(kpi.call_dates),
      customerDates: strings(kpi.customer_dates),
    },
    demands: { new: count(demands.new), active: count(demands.active), matched: count(demands.matched) },
    period: { p7, p30, p90, customerDates90: strings(period.customer_dates_90), demandDates90: strings(period.demand_dates_90) },
    decisions: {
      approvalsPending: count(decisions.approvals_pending),
      lostThisMonth: Math.max(0, num(decisions.lost_this_month)),
      overdueRent: count(decisions.overdue_rent),
      passiveDays: count(decisions.passive_days) || 30,
      passiveAdvisors: count(decisions.passive_advisors),
    },
    expiringAuthority: { mine: parseAuthorityRows(authority.mine), office: parseAuthorityRows(authority.office) },
  };
}

export type PeriodStats = {
  customers: number;
  customersPrev: number;
  demands: number;
  demandsPrev: number;
  /** Seri tam değilse `null` (kırpık seri çizilmez — loadPeriodStats ile aynı kural). */
  customerDates: string[] | null;
  demandDates: string[] | null;
};

/**
 * 90 günlük tarih serisinden `period` (7/30/90) gün alt serisi. Alt seri yalnız TAM olduğu biliniyorsa döner:
 * 90'lık seri tavana çarpmadıysa her alt seri tamdır; çarptıysa en eski tarih dönem başından ÖNCE ise alt seri tamdır.
 * Tam olan alt seri de 500'ü aşıyorsa (mümkün değil ama) null.
 */
export function periodSeries(dates90: readonly string[], periodStartIso: string, limit: number = SNAPSHOT_SERIES_LIMIT): string[] | null {
  const capped = dates90.length >= limit;
  if (capped) {
    const oldest = dates90.reduce((a, d) => (d < a ? d : a), dates90[0] ?? "");
    if (!oldest || oldest >= periodStartIso) return null;
  }
  const subset = dates90.filter((d) => d >= periodStartIso);
  return subset.length >= limit ? null : subset;
}

export function periodStatsFromSnapshot(m: MetricsSnapshot, period: 7 | 30 | 90, periodStartIso: string): PeriodStats {
  const c = period === 7 ? m.period.p7 : period === 30 ? m.period.p30 : m.period.p90;
  return {
    customers: c.customers,
    customersPrev: c.customersPrev,
    demands: c.demands,
    demandsPrev: c.demandsPrev,
    customerDates: periodSeries(m.period.customerDates90, periodStartIso),
    demandDates: periodSeries(m.period.demandDates90, periodStartIso),
  };
}

/* ------------------------------------ İçgörüler ------------------------------------ */

export type InsightsSnapshot = { rows: InsightDbRow[]; counts: InsightStateCounts };

export function parseInsightsSnapshot(raw: unknown): InsightsSnapshot | null {
  if (!isObj(raw) || !Array.isArray(raw.rows)) return null;
  const rawCounts = raw.counts;
  if (!isObj(rawCounts)) return null;
  const rows: InsightDbRow[] = [];
  for (const r of raw.rows) {
    if (!isObj(r)) continue;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.href !== "string" || typeof r.valid_until !== "string" || typeof r.created_at !== "string") continue;
    rows.push(r as unknown as InsightDbRow);
  }
  const counts = Object.fromEntries(INSIGHT_STATES.map((s) => [s, count(rawCounts[s])])) as InsightStateCounts;
  return { rows, counts };
}
