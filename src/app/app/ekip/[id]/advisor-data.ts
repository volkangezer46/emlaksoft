import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, now, trDayStartMs } from "@/lib/clock";
import { OPEN_DEMAND_STATUSES, untrackedCustomerIds } from "@/lib/team/advisor-360";
import { currentMonthPeriod, loadAdvisorMetrics, type MetricsViewer } from "@/lib/team/advisor-metrics";

/** Danışman 360 ortak veri okumaları (RLS ile tenant'a kilitli, istemci sunucu oturumundan gelir). */

export type LeadData = {
  overdueTasks: number;
  todayTasks: number;
  todayAppointments: number;
  staleCustomers: number;
  /** Açık talebi olup kendisine atanmış açık görevi bulunmayan müşteriler (ilk 8 ad ile). */
  untracked: { count: number; sample: { id: string; name: string }[] };
  /** Tarama tavanına dayandıysa takipsiz sayısı güvenilmez: gösterilmez. */
  untrackedPartial: boolean;
  overdueSample: { id: string; title: string; due_at: string; customer_id: string | null }[];
  todaySample: { id: string; title: string; due_at: string; customer_id: string | null }[];
};

const SCAN = 1000;

export async function loadLeadData(supabase: SupabaseClient, id: string): Promise<LeadData> {
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const dayStart = trDayStartMs(nowMs);
  const dayStartIso = new Date(dayStart).toISOString();
  const dayEndIso = new Date(dayStart + 86_400_000).toISOString();

  const openTasks = () => supabase.from("tasks").select("id, title, due_at, customer_id", { count: "exact" }).eq("assigned_to", id).eq("status", "open");

  const [overdue, today, appts, stale, demands, openCustomerTasks] = await Promise.all([
    openTasks().lt("due_at", nowIso).order("due_at", { ascending: true }).limit(8),
    openTasks().gte("due_at", dayStartIso).lt("due_at", dayEndIso).order("due_at", { ascending: true }).limit(8),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", id)
      .gte("scheduled_at", dayStartIso)
      .lt("scheduled_at", dayEndIso)
      .neq("status", "cancelled"),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", id)
      .is("deleted_at", null)
      .lt("updated_at", daysAgoIso(30)),
    supabase
      .from("customer_demands")
      .select("customer_id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
      .eq("customer.assigned_to", id)
      .in("status", [...OPEN_DEMAND_STATUSES])
      .limit(SCAN),
    supabase.from("tasks").select("customer_id").eq("assigned_to", id).eq("status", "open").not("customer_id", "is", null).limit(SCAN * 2),
  ]);

  const demandRows = (demands.data ?? []) as unknown as { customer_id: string | null }[];
  const taskRows = (openCustomerTasks.data ?? []) as unknown as { customer_id: string | null }[];
  const untrackedIds = untrackedCustomerIds(
    demandRows.map((d) => d.customer_id),
    taskRows.map((t) => t.customer_id),
  );
  const untrackedPartial = demandRows.length >= SCAN || taskRows.length >= SCAN * 2 || Boolean(demands.error || openCustomerTasks.error);

  let sample: { id: string; name: string }[] = [];
  if (!untrackedPartial && untrackedIds.length > 0) {
    const { data } = await supabase.from("customers").select("id, full_name").in("id", untrackedIds.slice(0, 8));
    sample = ((data ?? []) as { id: string; full_name: string }[]).map((c) => ({ id: c.id, name: c.full_name }));
  }

  type TaskRow = { id: string; title: string; due_at: string; customer_id: string | null };
  return {
    overdueTasks: overdue.count ?? 0,
    todayTasks: today.count ?? 0,
    todayAppointments: appts.count ?? 0,
    staleCustomers: stale.count ?? 0,
    untracked: { count: untrackedPartial ? 0 : untrackedIds.length, sample },
    untrackedPartial,
    overdueSample: (overdue.data ?? []) as unknown as TaskRow[],
    todaySample: (today.data ?? []) as unknown as TaskRow[],
  };
}

export type MonthKpis = {
  customers: { cur: number; prev: number };
  appointments: { cur: number; prev: number };
  offers: { cur: number; prev: number };
  deals: { cur: number; prev: number };
  callsCur: number;
};

export type MemberMonth = {
  kpis: MonthKpis;
  /** Tahsil edilen danışman payı (bu ay / önceki ay). `null` = görme hakkı yok. */
  revenue: { cur: number | null; prev: number | null };
  /** Atanmış müşteri (toplam) ve yayındaki portföy. */
  customerTotal: number;
  activePropertyCount: number;
};

/**
 * Bu ay / önceki ay: TEK KAYNAK `loadAdvisorMetrics` (Danışman KPI, Kıyas, Lig, Kazanç, Hedefler ile aynı tanım):
 * yeni müşteri, randevu (iptalsiz), teklif, anlaşma (kabul edilen teklif), çağrı, gelir (komisyon payı, tahsil).
 * Bu dosya artık kendi sorgusunu yazmaz.
 */
export async function loadMemberMonth(
  supabase: SupabaseClient,
  opts: { viewer: MetricsViewer; tenantId: string | null; id: string; nowMs: number },
): Promise<MemberMonth> {
  const { viewer, tenantId, id, nowMs } = opts;
  const [cur, prev] = await Promise.all([
    loadAdvisorMetrics(supabase, { viewer, tenantId, period: currentMonthPeriod(nowMs), nowMs, subjectIds: [id] }),
    loadAdvisorMetrics(supabase, { viewer, tenantId, period: currentMonthPeriod(nowMs, -1), nowMs, subjectIds: [id] }),
  ]);
  const c = cur.rows.find((r) => r.id === id);
  const p = prev.rows.find((r) => r.id === id);
  return {
    kpis: {
      customers: { cur: c?.newCustomerCount ?? 0, prev: p?.newCustomerCount ?? 0 },
      appointments: { cur: c?.appointCount ?? 0, prev: p?.appointCount ?? 0 },
      offers: { cur: c?.offerCount ?? 0, prev: p?.offerCount ?? 0 },
      deals: { cur: c?.dealCount ?? 0, prev: p?.dealCount ?? 0 },
      callsCur: c?.callCount ?? 0,
    },
    revenue: { cur: c?.revenue ?? null, prev: p?.revenue ?? null },
    customerTotal: c?.customerCount ?? 0,
    activePropertyCount: c?.activePropertyCount ?? 0,
  };
}
