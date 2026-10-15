import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trDayStartMs } from "@/lib/clock";
import { fetchAllPaged } from "@/lib/cron-run";
import { findNotifiedKeys, insertNotificationsDetailed } from "@/lib/notify-batch";
import {
  departureReminderKey,
  planDepartureReminders,
  twoHourReminderKey,
  type DepartureAppointment,
} from "@/lib/appointment-departure";

/**
 * GA-07: `randevu-hatirlat` cron'unun ayrık adımı (YENİ cron yok). Bugünün (TR) başından önümüzdeki 3 saate kadar
 * randevular okunur: başlamış olanlar yalnız "önceki durak" konumu için kullanılır. Kendi istemcisini oluşturmaz.
 */
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type Row = {
  id: string;
  tenant_id: string;
  scheduled_at: string;
  duration_min: number | null;
  appointment_type: string | null;
  status: string | null;
  assigned_to: string | null;
  created_by: string | null;
  customer: Rel<{ full_name: string | null }>;
  property: Rel<{ lat: number | null; lng: number | null }>;
};

export type DepartureStepResult = { written: number; failed: number };

export async function runDepartureReminderStep(admin: SupabaseClient, opts: { nowMs: number }): Promise<DepartureStepResult> {
  const fromIso = new Date(trDayStartMs(opts.nowMs)).toISOString();
  const toIso = new Date(opts.nowMs + 3 * 3_600_000).toISOString();
  const { rows, error } = await fetchAllPaged<Row>((from, to) =>
    admin
      .from("appointments")
      .select(
        "id, tenant_id, scheduled_at, duration_min, appointment_type, status, assigned_to, created_by, customer:customers!appointments_customer_id_fkey(full_name), property:properties!appointments_property_id_fkey(lat, lng)",
      )
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .neq("status", "cancelled")
      .eq("is_sample", false)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  );
  if (error && rows.length === 0) return { written: 0, failed: 1 };

  const list: DepartureAppointment[] = rows.map((r) => {
    const p = one(r.property);
    return {
      id: r.id,
      tenant_id: String(r.tenant_id),
      scheduled_at: r.scheduled_at,
      duration_min: r.duration_min,
      appointment_type: r.appointment_type,
      status: r.status,
      assigned_to: r.assigned_to,
      created_by: r.created_by,
      customerName: one(r.customer)?.full_name ?? null,
      lat: p?.lat ?? null,
      lng: p?.lng ?? null,
    };
  });
  const upcoming = list.filter((a) => Date.parse(a.scheduled_at) > opts.nowMs);
  if (upcoming.length === 0) return { written: 0, failed: 0 };
  const tenantIds = [...new Set(upcoming.map((a) => a.tenant_id))];
  const keys = upcoming.flatMap((a) => [departureReminderKey(a), twoHourReminderKey(a)]);
  const known = await findNotifiedKeys(admin, { tenantIds, keys });
  // Anahtar okunamadıysa (null) bu tur yazılmaz: çift bildirim riskine girilmez.
  if (known == null) return { written: 0, failed: 1 };
  const plan = planDepartureReminders(list, { nowMs: opts.nowMs, isAlreadyNotified: (k) => known.has(k) });
  const res = await insertNotificationsDetailed(admin, plan.rows);
  return { written: res.written, failed: res.failed };
}
