import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, now, trDayStartMs } from "@/lib/clock";
import { OPEN_DEMAND_STATUSES, inRange, untrackedCustomerIds } from "@/lib/team/advisor-360";

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

/**
 * Bu ay / önceki ay: müşteri (atanmış, o ay açılan), randevu (planlanan), teklif (oluşturan),
 * anlaşma (kabul edilen teklif; hedef gerçekleşmesiyle aynı tanım), çağrı (yalnız bu ay).
 * Tarama tavanı 2000 satır/tablo; bir danışmanın iki aylık hacmi bunun çok altındadır.
 */
export async function loadMonthKpis(
  supabase: SupabaseClient,
  id: string,
  r: { prevStartIso: string; thisStartIso: string; nextStartIso: string },
): Promise<MonthKpis> {
  const [cust, appt, offers, calls] = await Promise.all([
    supabase.from("customers").select("created_at").eq("assigned_to", id).is("deleted_at", null).gte("created_at", r.prevStartIso).lt("created_at", r.nextStartIso).limit(2000),
    supabase.from("appointments").select("scheduled_at").eq("assigned_to", id).neq("status", "cancelled").gte("scheduled_at", r.prevStartIso).lt("scheduled_at", r.nextStartIso).limit(2000),
    supabase.from("offers").select("created_at, status").eq("created_by", id).gte("created_at", r.prevStartIso).lt("created_at", r.nextStartIso).limit(2000),
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("handled_by", id).gte("started_at", r.thisStartIso).lt("started_at", r.nextStartIso),
  ]);
  const split = (rows: { at: string }[]) => ({
    cur: rows.filter((x) => inRange(x.at, r.thisStartIso, r.nextStartIso)).length,
    prev: rows.filter((x) => inRange(x.at, r.prevStartIso, r.thisStartIso)).length,
  });
  const offerRows = (offers.data ?? []) as { created_at: string; status: string }[];
  return {
    customers: split(((cust.data ?? []) as { created_at: string }[]).map((x) => ({ at: x.created_at }))),
    appointments: split(((appt.data ?? []) as { scheduled_at: string }[]).map((x) => ({ at: x.scheduled_at }))),
    offers: split(offerRows.map((x) => ({ at: x.created_at }))),
    deals: split(offerRows.filter((x) => x.status === "accepted").map((x) => ({ at: x.created_at }))),
    callsCur: calls.count ?? 0,
  };
}
