import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";

/**
 * /app/asistan komuta merkezi — ek KPI sayıları.
 *
 * getTenantAdvisorSnapshot yalnızca 4 alan döndürür; buradaki hafif
 * head-count sorguları hero şeridini ve öneri kartlarını besler. RLS'li
 * normal client kullanılır (tenant kapsaması otomatik). Yalnızca server
 * tarafında (page.tsx) import edilir.
 */

export type AsistanInsights = {
  todayAppointments: number;
  newDemands: number;
  activeDeals: number;
  tasksDueToday: number;
  wonThisMonth: number;
};

export async function getAsistanInsights(): Promise<AsistanInsights> {
  const supabase = await createClient();

  // Zaman okumaları clock.now() üzerinden (render'da doğrudan Date.now yok)
  const dayStart = new Date(now());
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const monthStart = new Date(dayStart);
  monthStart.setDate(1);

  const [
    { count: todayAppointments },
    { count: newDemands },
    { count: activeDeals },
    { count: tasksDueToday },
    { count: wonThisMonth },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString())
      .neq("status", "cancelled"),
    supabase
      .from("customer_demands")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .not("stage", "in", "(won,lost)"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .gte("due_at", dayStart.toISOString())
      .lt("due_at", dayEnd.toISOString()),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("stage", "won")
      .gte("updated_at", monthStart.toISOString()),
  ]);

  return {
    todayAppointments: todayAppointments ?? 0,
    newDemands: newDemands ?? 0,
    activeDeals: activeDeals ?? 0,
    tasksDueToday: tasksDueToday ?? 0,
    wonThisMonth: wonThisMonth ?? 0,
  };
}
