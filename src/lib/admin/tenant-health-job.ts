import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan } from "@/lib/billing/plans";
import { DAY_MS, trDayKey } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { getSettings } from "@/lib/settings/read";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { HEALTH_WINDOW_DAYS, computeHealth, normalizeWeights, type HealthWeights } from "./health-score";
import { isCrmMissing } from "./platform-crm";

/**
 * OFİS CRM zamanlanmış adımları — `gorev-hatirlat` cron'unun (2 saatte bir) AYRIK adımları (yeni cron yok).
 *  1) `runTenantHealthDaily`: TR gününde BİR kez — o günün `tenant_health_daily` satır sayısı skorlanacak ofis sayısına
 *     (iptal olmayan ofisler = RPC kapsamı) ulaştıysa atlanır; yarım kalan tur (parça/son skor hatası) sonraki 2 saatlik
 *     turda baştan yazılır (upsert idempotent). Ağırlıklar ayar defterinden her koşuda yeniden okunur → ağırlık değişikliği
 *     ERTESİ hesaplamaya yansır. Son skor `platform_tenant_crm.health_score`'a da yazılır (liste/süzgeç/pano tek sütundan
 *     okur). Aşama (`lifecycle_stage`) bu işte YAZILMAZ: yalnız elle seçim saklanır, boşsa okuma anında durumdan türetilir.
 *  2) `runPlatformTaskReminders`: vadesi gelmiş, bildirilmemiş açık platform görevleri sorumlunun bildirim kutusuna
 *     (`platform_notifications`) düşer; görev `notified_at` ile işaretlenir (tekrar bildirim yok; vade değişince sıfırlanır).
 * `admin` çağıranın (route) service_role istemcisidir; burada yeni istemci oluşturulmaz. Tablolar yoksa adımlar `skipped`.
 */

export type HealthJobSummary = { skipped: boolean; written: number; error: string | null };
export type TaskReminderSummary = { skipped: boolean; notified: number; error: string | null };

type InputRow = {
  tenant_id: string;
  status: string;
  plan: string | null;
  sub_status: string | null;
  login_days: number;
  active_users: number;
  extra_seats: number;
  module_areas: number;
  open_tickets: number;
  csat_avg: number | string | null;
  csat_n: number;
  overdue_invoices: number;
  max_overdue_days: number;
};

const CHUNK = 500;

async function readWeights(): Promise<HealthWeights> {
  try {
    const s = await getSettings([CRM_SETTING_KEYS.weightUsage, CRM_SETTING_KEYS.weightPayment, CRM_SETTING_KEYS.weightSupport]);
    return normalizeWeights({ usage: s[CRM_SETTING_KEYS.weightUsage], payment: s[CRM_SETTING_KEYS.weightPayment], support: s[CRM_SETTING_KEYS.weightSupport] });
  } catch {
    return normalizeWeights({});
  }
}

export async function runTenantHealthDaily(admin: SupabaseClient, nowMs: number, opts: { weights?: HealthWeights; force?: boolean } = {}): Promise<HealthJobSummary> {
  const day = trDayKey(nowMs);
  if (!opts.force) {
    // Tek satır yetmez: o günün satır sayısı skorlanacak ofis sayısına ulaşmadıysa tur yarım kalmıştır → yeniden hesapla.
    const [done, expected] = await Promise.all([
      admin.from("tenant_health_daily").select("tenant_id", { count: "exact", head: true }).eq("day", day),
      admin.from("tenants").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
    ]);
    if (done.error) return isCrmMissing(done.error) ? { skipped: true, written: 0, error: null } : { skipped: false, written: 0, error: done.error.message };
    if (!expected.error && (done.count ?? 0) > 0 && (done.count ?? 0) >= (expected.count ?? 0)) return { skipped: true, written: 0, error: null };
  }

  const { data, error } = await admin.rpc("platform_tenant_health_inputs", {
    p_since: new Date(nowMs - HEALTH_WINDOW_DAYS * DAY_MS).toISOString(),
    p_now: new Date(nowMs).toISOString(),
  });
  if (error) return isCrmMissing(error) ? { skipped: true, written: 0, error: null } : { skipped: false, written: 0, error: error.message };

  const weights = opts.weights ?? (await readWeights());
  const computedAt = new Date(nowMs).toISOString();
  const daily: Record<string, unknown>[] = [];
  const latest: Record<string, unknown>[] = [];
  for (const r of (data ?? []) as InputRow[]) {
    const plan = getPlan(r.plan ?? "office");
    const seatLimit = plan.limits.seats > 0 ? plan.limits.seats + Math.max(0, Number(r.extra_seats) || 0) : null;
    const csatAvg = r.csat_avg === null || r.csat_avg === undefined ? null : Number(r.csat_avg);
    const inputs = {
      status: r.status,
      subStatus: r.sub_status,
      loginDays: Number(r.login_days) || 0,
      activeUsers: Number(r.active_users) || 0,
      seatLimit,
      moduleAreas: Number(r.module_areas) || 0,
      openTickets: Number(r.open_tickets) || 0,
      csatAvg: Number.isFinite(csatAvg) ? csatAvg : null,
      csatN: Number(r.csat_n) || 0,
      overdueInvoices: Number(r.overdue_invoices) || 0,
      maxOverdueDays: Number(r.max_overdue_days) || 0,
    };
    const h = computeHealth(inputs, weights);
    daily.push({
      day,
      tenant_id: r.tenant_id,
      score: h.score,
      usage_score: h.usage,
      payment_score: h.payment,
      support_score: h.support,
      inputs: { ...inputs, reasons: h.reasons },
      weights,
      computed_at: computedAt,
    });
    latest.push({ tenant_id: r.tenant_id, health_score: h.score, health_scored_at: computedAt });
  }

  // Önce son skor (yalnız sağlık sütunları, merge: elle seçilen sorumlu/aşama EZİLMEZ), sonra günlük satırlar: günlük
  // yazım yarıda kalırsa sayım tutmaz ve sonraki tur hepsini yeniden yazar; son skor bayat kalmaz.
  for (let i = 0; i < latest.length; i += CHUNK) {
    const res = await admin.from("platform_tenant_crm").upsert(latest.slice(i, i + CHUNK), { onConflict: "tenant_id" });
    if (res.error) return { skipped: false, written: 0, error: `son skor: ${res.error.message}` };
  }
  let written = 0;
  for (let i = 0; i < daily.length; i += CHUNK) {
    const res = await admin.from("tenant_health_daily").upsert(daily.slice(i, i + CHUNK), { onConflict: "day,tenant_id" });
    if (res.error) return { skipped: false, written, error: res.error.message };
    written += Math.min(CHUNK, daily.length - i);
  }
  return { skipped: false, written, error: null };
}

export async function runPlatformTaskReminders(admin: SupabaseClient, nowMs: number): Promise<TaskReminderSummary> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await admin
    .from("platform_tasks")
    .select("id, tenant_id, title, due_at, assignee_staff_id, tenant:tenants!platform_tasks_tenant_id_fkey(name)")
    .eq("status", "open")
    .is("notified_at", null)
    .not("assignee_staff_id", "is", null)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(500);
  if (error) return isCrmMissing(error) ? { skipped: true, notified: 0, error: null } : { skipped: false, notified: 0, error: error.message };
  const tasks = (data ?? []) as unknown as { id: string; tenant_id: string | null; title: string; due_at: string; assignee_staff_id: string; tenant: { name: string } | null }[];
  if (tasks.length === 0) return { skipped: false, notified: 0, error: null };

  const ins = await admin.from("platform_notifications").insert(
    tasks.map((t) => ({
      staff_id: t.assignee_staff_id,
      title: "Görevin vadesi geldi",
      body: `${t.title}${t.tenant?.name ? ` · ${t.tenant.name}` : ""} · ${formatDateTimeTr(t.due_at)}`,
      href: t.tenant_id ? `/admin/tenants/${t.tenant_id}?sekme=iliski` : "/admin/bildirimler",
      kind: "warning",
      meta: { source: "platform_task", task_id: t.id },
    })),
  );
  if (ins.error) return { skipped: false, notified: 0, error: ins.error.message };
  const upd = await admin.from("platform_tasks").update({ notified_at: nowIso }).in("id", tasks.map((t) => t.id)).is("notified_at", null);
  if (upd.error) return { skipped: false, notified: tasks.length, error: `işaretleme: ${upd.error.message}` };
  return { skipped: false, notified: tasks.length, error: null };
}
