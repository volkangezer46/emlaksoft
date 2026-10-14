import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appointmentConfirmUrl,
  appointmentCustomerText,
  shouldRemindCustomer,
  isCustomerMessageHour,
} from "@/lib/appointment-messages";
import { now } from "@/lib/clock";
import { fetchAllPaged } from "@/lib/cron-run";
import { isTenantSmsAvailable, sendTenantSms } from "@/lib/messaging/tenant-providers";
import { isValidTurkishMobile } from "@/lib/phone";
import { APPOINTMENT_CUSTOMER_SMS_KEY } from "@/lib/settings/registry/appointments";
import { readTenantSettings } from "@/lib/settings/tenant-read";

/**
 * YD3 müşteriye randevu iletisi (SMS) — İŞLEM AMAÇLI (İYS `appointment_reminder`, muaf; `iys-gate-contract.test.ts`
 * TRANSACTIONAL kaydı). Gönderim günlüğü `message_sends` kaynakları: `appointment_confirm`, `appointment_reminder`.
 *
 * Kurallar:
 *  - Yalnız ofis ayarı (`office.appointment.customer_sms`) AÇIK, ofisin SMS kanalı hazır ve müşterinin TR cep numarası
 *    kayıtlıysa gönderilir. Kanal yoksa SAHTE BAŞARI YOK: sonuç "kanal yok" döner; danışman randevu satırındaki
 *    "WhatsApp'ta teyit gönder" bağlantısını kullanır.
 *  - Örnek veri (is_sample) müşteriye ileti üretmez.
 *  - Hatırlatma, satır `customer_reminded_at is null` koşuluyla ATOMİK kapıldıktan SONRA gönderilir (paralel cron
 *    turları aynı SMS'i iki kez atmaz). Sağlayıcıya hiç gitmeyen hata (kanal çözülemedi) kapmayı geri bırakır.
 * Kendi istemcisini OLUŞTURMAZ: action oturumlu istemciyi, cron kendi service_role istemcisini verir.
 */

export type ConfirmSendOutcome = "sms_sent" | "sms_failed" | "off" | "no_channel" | "no_phone";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

type ConfirmRow = {
  id: string;
  appointment_type: string | null;
  scheduled_at: string;
  confirm_token: string | null;
  is_sample: boolean | null;
  customer: Rel<{ full_name: string | null; phone: string | null }>;
};

/** Yeni randevu: müşteriye teyit SMS'i (ayar açıksa). Hata iş akışını BOZMAZ; sonuç yalnız bilgi amaçlıdır. */
export async function sendAppointmentConfirmation(
  db: SupabaseClient,
  input: { tenantId: string; appointmentId: string; appUrl: string },
): Promise<ConfirmSendOutcome> {
  try {
    const settings = await readTenantSettings(db, input.tenantId, [APPOINTMENT_CUSTOMER_SMS_KEY]);
    if (settings[APPOINTMENT_CUSTOMER_SMS_KEY] !== true) return "off";

    const [{ data: appt }, { data: tenant }] = await Promise.all([
      db
        .from("appointments")
        .select("id, appointment_type, scheduled_at, confirm_token, is_sample, customer:customers!appointments_customer_id_fkey(full_name, phone)")
        .eq("tenant_id", input.tenantId)
        .eq("id", input.appointmentId)
        .maybeSingle(),
      db.from("tenants").select("name").eq("id", input.tenantId).maybeSingle(),
    ]);
    const row = appt as ConfirmRow | null;
    if (!row || row.is_sample) return "off";
    const customer = one(row.customer);
    if (!customer?.phone || !isValidTurkishMobile(customer.phone)) return "no_phone";
    if (!(await isTenantSmsAvailable(input.tenantId))) return "no_channel";

    const text = appointmentCustomerText({
      kind: "confirm",
      customerName: customer.full_name,
      officeName: (tenant as { name?: string | null } | null)?.name ?? null,
      appointmentType: row.appointment_type,
      scheduledAt: row.scheduled_at,
      confirmUrl: appointmentConfirmUrl(input.appUrl, row.confirm_token),
    });
    const res = await sendTenantSms(input.tenantId, customer.phone, text, { source: "appointment_confirm", audience: "contact" });
    if (!res.ok) return "sms_failed";
    // İz (kolon yoksa sessizce atlanır): cron aynı gün ikinci SMS atmasın diye okur.
    const { error } = await db
      .from("appointments")
      .update({ customer_confirm_sent_at: new Date(now()).toISOString() })
      .eq("tenant_id", input.tenantId)
      .eq("id", row.id);
    if (error) console.error("appointment confirm mark", { code: error.code });
    return "sms_sent";
  } catch (e) {
    console.error("sendAppointmentConfirmation", e instanceof Error ? e.message : "hata");
    return "sms_failed";
  }
}

type ReminderRow = {
  id: string;
  tenant_id: string;
  appointment_type: string | null;
  scheduled_at: string;
  status: string | null;
  confirm_token: string | null;
  customer_response: string | null;
  customer_reminded_at: string | null;
  customer_confirm_sent_at: string | null;
  customer: Rel<{ full_name: string | null; phone: string | null }>;
};

export type CustomerReminderResult = { sent: number; failed: number; note: string | null };

/** Sağlayıcıya hiç ulaşmayan hata: kapma geri bırakılır, sonraki turda yeniden denenir. */
const NOT_SENT_CODES = new Set(["provider_resolution_error", "tenant_provider_unconfigured"]);

/**
 * `randevu-hatirlat` cron'unun ayrık adımı: önümüzdeki 24 saatteki randevular için müşteriye BİR KEZ hatırlatma SMS'i.
 * Yalnız ayarı açık ve SMS kanalı hazır ofisler; gece (21:00–09:00) hiç çalışmaz.
 */
export async function runCustomerReminderStep(
  admin: SupabaseClient,
  opts: { nowMs: number; appUrl: string },
): Promise<CustomerReminderResult> {
  if (!isCustomerMessageHour(opts.nowMs)) return { sent: 0, failed: 0, note: null };
  const fromIso = new Date(opts.nowMs).toISOString();
  const toIso = new Date(opts.nowMs + 24 * 3_600_000).toISOString();

  const { rows, error } = await fetchAllPaged<ReminderRow>((from, to) =>
    admin
      .from("appointments")
      .select(
        "id, tenant_id, appointment_type, scheduled_at, status, confirm_token, customer_response, customer_reminded_at, customer_confirm_sent_at, customer:customers!appointments_customer_id_fkey(full_name, phone)",
      )
      .gte("scheduled_at", fromIso)
      .lte("scheduled_at", toIso)
      .in("status", ["pending", "confirmed"])
      .is("customer_reminded_at", null)
      .not("customer_id", "is", null)
      .eq("is_sample", false)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: ReminderRow[] | null; error: { message: string } | null }>,
  );
  // Kolon yoksa (migration 20261015043000 uygulanmadı) adım sessizce atlanır; danışman hatırlatması etkilenmez.
  if (error && rows.length === 0) return { sent: 0, failed: 0, note: "müşteri adımı atlandı" };

  const candidates = rows.filter((r) => {
    const phone = one(r.customer)?.phone ?? null;
    return shouldRemindCustomer({ ...r, hasMobile: Boolean(phone && isValidTurkishMobile(phone)) }, opts.nowMs);
  });
  if (candidates.length === 0) return { sent: 0, failed: 0, note: null };

  const tenantIds = [...new Set(candidates.map((r) => String(r.tenant_id)))];
  const enabled = new Set<string>();
  await Promise.all(
    tenantIds.map(async (tenantId) => {
      const s = await readTenantSettings(admin, tenantId, [APPOINTMENT_CUSTOMER_SMS_KEY]);
      if (s[APPOINTMENT_CUSTOMER_SMS_KEY] === true && (await isTenantSmsAvailable(tenantId))) enabled.add(tenantId);
    }),
  );
  if (enabled.size === 0) return { sent: 0, failed: 0, note: null };

  const { data: tenants } = await admin.from("tenants").select("id, name").in("id", [...enabled]);
  const officeName = new Map(((tenants ?? []) as { id: string; name: string | null }[]).map((t) => [t.id, t.name]));

  let sent = 0;
  let failed = 0;
  for (const r of candidates) {
    const tenantId = String(r.tenant_id);
    if (!enabled.has(tenantId)) continue;
    const customer = one(r.customer);
    if (!customer?.phone) continue;
    const claimedAt = new Date(opts.nowMs).toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("appointments")
      .update({ customer_reminded_at: claimedAt })
      .eq("tenant_id", tenantId)
      .eq("id", r.id)
      .is("customer_reminded_at", null)
      .select("id");
    if (claimError || !claimed || claimed.length === 0) continue;

    const text = appointmentCustomerText({
      kind: "reminder",
      customerName: customer.full_name,
      officeName: officeName.get(tenantId) ?? null,
      appointmentType: r.appointment_type,
      scheduledAt: r.scheduled_at,
      confirmUrl: appointmentConfirmUrl(opts.appUrl, r.confirm_token),
    });
    const res = await sendTenantSms(tenantId, customer.phone, text, { source: "appointment_reminder", audience: "contact" });
    if (res.ok) {
      sent += 1;
      continue;
    }
    failed += 1;
    if (res.code && NOT_SENT_CODES.has(res.code)) {
      await admin.from("appointments").update({ customer_reminded_at: null }).eq("tenant_id", tenantId).eq("id", r.id).eq("customer_reminded_at", claimedAt);
    }
  }
  return { sent, failed, note: null };
}
