import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findNotifiedIds, findNotifiedKeys, insertNotificationsDetailed } from "@/lib/notify-batch";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getBaseUrl } from "@/lib/base-url";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { fetchAllPaged, heartbeatFor, guardCron } from "@/lib/cron-run";
import { appointmentReminderKey, planAdvisorReminders, type ReminderAppointment } from "@/lib/appointment-messages";
import { runCustomerReminderStep } from "@/lib/appointment-customer-messages";
import { runWebhookRetries } from "@/lib/integrations-api/webhooks";

const APP_URL = getBaseUrl();

/** Çok ofisli toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/** Hatırlatma penceresi: önümüzdeki 24 SAAT (eski hesap 24 * 86_400_000 = 24 gündü; 3 hafta sonraki randevu "yaklaşan" sayılıyordu). */
const REMINDER_WINDOW_MS = 24 * 3_600_000;

type ApptRow = {
  id: string;
  tenant_id: string;
  scheduled_at: string;
  confirm_token: string | null;
  assigned_to: string | null;
  created_by: string | null;
  customer: { full_name?: string } | { full_name?: string }[] | null;
};

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("randevu-hatirlat", req);
  if (pausedRun) return pausedRun;

  const admin = createAdminClient();
  const startedAt = Date.now();
  const from = new Date(startedAt);
  const to = new Date(startedAt + REMINDER_WINDOW_MS);

  // Global .limit(200) kaldırıldı: order(id) + range sayfalama; sorgu hatası heartbeat'e 'error' olarak yansır.
  const { rows: list, error: listError } = await fetchAllPaged<ApptRow>(
    (rangeFrom, rangeTo) =>
      admin
        .from("appointments")
        .select("id, tenant_id, scheduled_at, confirm_token, assigned_to, created_by, customer:customers!appointments_customer_id_fkey(full_name)")
        .gte("scheduled_at", from.toISOString())
        .lte("scheduled_at", to.toISOString())
        .neq("status", "cancelled")
        .eq("is_sample", false)
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo) as unknown as PromiseLike<{ data: ApptRow[] | null; error: { message: string } | null }>,
  );

  if (listError && list.length === 0) {
    console.error("randevu-hatirlat list", listError);
    await recordHeartbeat("randevu-hatirlat", "error", `randevu listesi okunamadı: ${listError}`);
    return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
  }

  const windowStart = new Date(startedAt - 20 * 3600_000).toISOString();

  // N+1 KALDIRILDI: randevu başına 1 SELECT + 1 INSERT yerine toplam birkaç sorgu.
  // Tekrar önleme: (1) dedupe_key (randevu + saat), (2) geçiş dönemi: eski ofis geneli bildirimlerin gövde izi `appt:<uuid>`
  // (href "/app/randevular"); yeni satırlar kişiye ve tek randevu bağlantısıyla yazılır, iz taşımaz.
  const appointments: ReminderAppointment[] = list.map((a) => {
    const cust = Array.isArray(a.customer) ? a.customer[0] : a.customer;
    return {
      id: a.id,
      tenant_id: String(a.tenant_id),
      scheduled_at: a.scheduled_at,
      confirm_token: a.confirm_token,
      assigned_to: a.assigned_to,
      created_by: a.created_by,
      customerName: cust?.full_name ?? null,
    };
  });
  const tenantIds = [...new Set(appointments.map((a) => a.tenant_id))];
  const [alreadyNotified, alreadyKeys] = await Promise.all([
    findNotifiedIds(admin, {
      href: "/app/randevular",
      tenantIds,
      sinceIso: windowStart,
      markerPrefix: "appt",
    }),
    findNotifiedKeys(admin, { tenantIds, keys: appointments.map(appointmentReminderKey) }),
  ]);

  // Hatırlatma YALNIZ randevunun sahibine (atanan danışman, yoksa açan); sahipsiz randevu ofis geneline bildirim üretmez.
  const plan = planAdvisorReminders(appointments, {
    appUrl: APP_URL,
    isAlreadyNotified: (a) => alreadyNotified.has(String(a.id).toLowerCase()) || Boolean(alreadyKeys?.has(appointmentReminderKey(a))),
  });

  const result = await insertNotificationsDetailed(admin, plan.rows);
  const notified = result.written;

  // Müşteriye hatırlatma SMS'i (ofis ayarı açıksa; bu cron'un ayrık adımı, YENİ cron yok). Hata danışman adımını etkilemez.
  let customerNote = "";
  let customerFailed = 0;
  try {
    const cr = await runCustomerReminderStep(admin, { nowMs: startedAt, appUrl: APP_URL });
    customerFailed = cr.failed;
    if (cr.sent > 0 || cr.failed > 0) customerNote = `, müşteriye SMS ${cr.sent}${cr.failed ? ` (${cr.failed} hata)` : ""}`;
    else if (cr.note) customerNote = `, ${cr.note}`;
  } catch (e) {
    console.error("randevu-hatirlat müşteri", e instanceof Error ? e.message : "hata");
    customerNote = ", müşteri adımı hata";
  }

  // Giden webhook yeniden denemeleri (30 dk'lık bu cron'un adımı; YENİ cron yok). Kanal kapalı/şema yoksa atlanır.
  let webhookNote = "";
  try {
    const wh = await runWebhookRetries(admin, Date.now());
    if (wh.attempted > 0) webhookNote = `, webhook ${wh.delivered}/${wh.attempted}`;
  } catch (e) {
    console.error("randevu-hatirlat webhook", e instanceof Error ? e.message : "hata");
  }

  const skipped = plan.skipped + result.duplicates;
  const unownedNote = plan.unowned > 0 ? `, ${plan.unowned} sahipsiz randevu atlandı` : "";
  const hb = heartbeatFor({
    total: list.length,
    processed: list.length,
    failed: result.failed + customerFailed,
    timedOut: false,
    listError,
    summary: `${notified} hatırlatma, ${skipped} atlandı${unownedNote}${customerNote}${webhookNote}`,
  });
  await recordHeartbeat("randevu-hatirlat", hb.status, hb.detail);

  return NextResponse.json({ ok: hb.status === "ok", notified, skipped, unowned: plan.unowned, failed: result.failed });
}

export const GET = guardCron("randevu-hatirlat", run);
