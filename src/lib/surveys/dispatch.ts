import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBaseUrl } from "@/lib/base-url";
import { isValidTurkishMobile, normalizeTurkishPhone } from "@/lib/phone";
import {
  isTenantSmsAvailable,
  isTenantWhatsAppAvailable,
  prepareTenantSmsSender,
  prepareTenantWhatsAppSender,
} from "@/lib/messaging/tenant-providers";
import {
  CONTACT_COOLDOWN_DAYS,
  LINK_GRACE_HOURS,
  MAX_SEND_ATTEMPTS,
  TENANT_SEND_CAP_PER_RUN,
  autoSendDecision,
  surveySmsText,
} from "@/lib/surveys/logic";
import { gateIysRecipients } from "@/lib/iys/gate";
import { isMissingColumn } from "@/lib/surveys/server";
import type { SurveySettings } from "@/lib/surveys/types";

/**
 * Otomatik anket gönderimi (anket-gorevleri cron adımı; YENİ cron yok).
 *
 * Ofis ayarı `survey_settings.auto_send` AÇIKSA ve ofisin SMS (Netgsm) ya da WhatsApp (onaylı şablon adı girilmiş)
 * kanalı hazırsa, vadesi gelen bekleyen görevin bağlı anket linki müşteriye gönderilir. Kurallar (saf
 * `autoSendDecision`): yalnız müşteri kaydı olan görev; ilgili kanalda İYS izni `granted` ve geri alınmamış; kara
 * listede/örnek olmayan, geçerli TR cep numarası; aynı müşteriye son 30 günde anket mesajı gitmemiş; görev başına en
 * çok 2 deneme; ofis başına tur başına en çok 50 gönderim. Gönderimden ÖNCE deneme sayacı iyimser kilitle artırılır
 * (eşzamanlı iki tur aynı görevi iki kez göndermez). Gönderilen görev 48 saat yanıt beklenir, sonra anketör kuyruğuna
 * düşer. Kanal yoksa / ayar kapalıysa hiçbir şey yapılmaz (anketör kuyruğu + link kopyala, bugünkü gibi).
 * `createAdminClient` BURADA çağrılmaz: cron'un istemcisi parametre gelir.
 */

type PendingRow = {
  id: string;
  public_token: string;
  status: string;
  sent_at: string | null;
  send_attempts: number;
  due_at: string;
  customer_id: string | null;
  event_type: string;
};

type CustomerRow = { id: string; phone: string | null; is_sample: boolean | null; blacklist: boolean | null; deleted_at: string | null };

export type DispatchSummary = { sent: number; failed: number; skipped: number; channelMissing: boolean };

export async function dispatchSurveyLinks(
  db: SupabaseClient,
  tenantId: string,
  settings: SurveySettings,
  nowMs: number,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, failed: 0, skipped: 0, channelMissing: false };
  if (!settings.auto_send) return summary;

  const [smsReady, waReady] = await Promise.all([
    isTenantSmsAvailable(tenantId).catch(() => false),
    settings.whatsapp_template ? isTenantWhatsAppAvailable(tenantId).catch(() => false) : Promise.resolve(false),
  ]);
  if (!smsReady && !waReady) {
    summary.channelMissing = true;
    return summary;
  }

  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await db
    .from("survey_tasks")
    .select("id, public_token, status, sent_at, send_attempts, due_at, customer_id, event_type")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .is("sent_at", null)
    .lt("send_attempts", MAX_SEND_ATTEMPTS)
    .not("customer_id", "is", null)
    .neq("event_type", "advisor_pulse")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(TENANT_SEND_CAP_PER_RUN * 2);
  if (error) {
    if (!isMissingColumn(error)) console.error("anket gönderimi: görevler", error.message);
    return summary;
  }
  const tasks = (data ?? []) as PendingRow[];
  if (tasks.length === 0) return summary;

  const customerIds = [...new Set(tasks.map((t) => String(t.customer_id)))];
  const sinceIso = new Date(nowMs - CONTACT_COOLDOWN_DAYS * 86_400_000).toISOString();
  const [{ data: tenant }, { data: customers }, [smsGate, waGate], { data: recent }] = await Promise.all([
    db.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    db.from("customers").select("id, phone, is_sample, blacklist, deleted_at").eq("tenant_id", tenantId).in("id", customerIds),
    // Merkezi İYS kapısı (src/lib/iys/gate.ts): anket ticari ileti sayılır; kanal bazlı izin burada denetlenir.
    Promise.all([
      gateIysRecipients(db, { tenantId, kind: "survey", channel: "sms", customerIds }),
      gateIysRecipients(db, { tenantId, kind: "survey", channel: "whatsapp", customerIds }),
    ]),
    db.from("survey_tasks").select("customer_id").eq("tenant_id", tenantId).in("customer_id", customerIds).gte("sent_at", sinceIso),
  ]);
  const custById = new Map(((customers ?? []) as CustomerRow[]).map((c) => [String(c.id), c]));
  const granted = new Set<string>([
    ...smsGate.allowed.map((id) => `${id}:sms`),
    ...waGate.allowed.map((id) => `${id}:whatsapp`),
  ]);
  const recentlySent = new Set(((recent ?? []) as { customer_id: string | null }[]).map((r) => String(r.customer_id)));
  const office = String((tenant as { name?: string } | null)?.name ?? "");

  const smsSender = smsReady ? await prepareTenantSmsSender(tenantId) : null;
  const waSender = waReady ? await prepareTenantWhatsAppSender(tenantId) : null;

  for (const t of tasks) {
    if (summary.sent >= TENANT_SEND_CAP_PER_RUN) break;
    const cid = String(t.customer_id);
    const cust = custById.get(cid);
    const phone = cust && !cust.is_sample && !cust.blacklist && !cust.deleted_at ? normalizeTurkishPhone(cust.phone ?? "") : "";
    const phoneOk = Boolean(cust?.phone) && isValidTurkishMobile(phone);
    const channel: "whatsapp" | "sms" | null =
      waSender && granted.has(`${cid}:whatsapp`) ? "whatsapp" : smsSender && granted.has(`${cid}:sms`) ? "sms" : null;
    const decision = autoSendDecision(t, { nowMs, consentGranted: channel !== null && phoneOk, contactRecentlySent: recentlySent.has(cid) });
    if (!decision.send || !channel) {
      summary.skipped += 1;
      continue;
    }

    // İyimser kilit: deneme sayacı önce artar; başka tur aynı görevi aldıysa satır güncellenmez → atla.
    const { data: claimed } = await db
      .from("survey_tasks")
      .update({ send_attempts: t.send_attempts + 1 })
      .eq("id", t.id)
      .eq("tenant_id", tenantId)
      .eq("send_attempts", t.send_attempts)
      .is("sent_at", null)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    const url = `${getBaseUrl()}/anket/${t.public_token}`;
    const text = surveySmsText(office, url);
    const result =
      channel === "whatsapp" && waSender
        ? await waSender(phone, { name: String(settings.whatsapp_template), language: settings.whatsapp_language, bodyParameter: url })
        : smsSender
          ? await smsSender(phone, text)
          : { ok: false as const };
    if (!result.ok) {
      summary.failed += 1;
      continue;
    }
    const sentIso = new Date(nowMs).toISOString();
    await db
      .from("survey_tasks")
      .update({ sent_via: channel, sent_at: sentIso, next_attempt_at: new Date(nowMs + LINK_GRACE_HOURS * 3_600_000).toISOString() })
      .eq("id", t.id)
      .eq("tenant_id", tenantId);
    recentlySent.add(cid);
    summary.sent += 1;
    // Müşteri zaman tüneli: giden mesaj kaydı (best-effort; hata gönderimi geri almaz).
    const { error: commErr } = await db.from("communications").insert({
      tenant_id: tenantId,
      customer_id: cid,
      created_by: null,
      channel,
      direction: "outbound",
      subject: "Anket bağlantısı",
      body: channel === "sms" ? text : `WhatsApp şablonu (${settings.whatsapp_template}): ${url}`,
    });
    if (commErr) console.error("anket gönderimi: iletişim kaydı", commErr.message);
  }
  return summary;
}
