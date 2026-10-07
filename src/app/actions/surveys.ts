"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { notifyTenant } from "@/lib/notify";
import { getBaseUrl } from "@/lib/base-url";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { canWorkTask, resolveWorkerAccess } from "@/lib/surveys/access";
import {
  LOW_SCORE_NOTE_MIN,
  applyAttemptOutcome,
  isValidEventAudience,
  pickBalancedAssignee,
  sanitizeQuestionDrafts,
  validLowScoreNote,
  validateAnswers,
} from "@/lib/surveys/logic";
import {
  completeSurveyTask,
  ensureSurveyDefaults,
  isMissingColumn,
  isSurveySchemaMissing,
  loadAssigneeIds,
  loadOpenLoad,
  loadSurveySettings,
  loadTemplateQuestions,
  type CompletableTask,
} from "@/lib/surveys/server";
import { loadPulseFormState, pulseEligibleRole } from "@/lib/surveys/pulse";
import { isModuleEnabled } from "@/lib/modules/state";
import { now } from "@/lib/clock";
import {
  SURVEY_ASSIGNMENT_MODES,
  isSurveyAudience,
  isSurveyEventType,
  type SurveyAssignmentMode,
  type SurveyOutcome,
} from "@/lib/surveys/types";
import { SESSION_EXPIRED_MESSAGE, actionErrorMessage } from "@/lib/action-errors";

export type SurveyResult = { error?: string; ok?: boolean; id?: string; url?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WA_TEMPLATE_RE = /^[a-z0-9_]{1,512}$/;
const WA_LANG_RE = /^[a-z]{2}(_[A-Z]{2})?$/;

function appUrl() {
  return getBaseUrl();
}

/**
 * Kapanan (stage='won') anlaşma için memnuniyet anketi üretir.
 *
 * Çift yetki kapısı: rapor sayfasından tetiklenir (reports.view) ama
 * anlaşma verisine dokunur — anlaşmaları göremeyen biri anket de üretemesin
 * (deals action'ları commissions modülüyle kapılı, aynı çizgi).
 *
 * SMS GÖNDERİLMEZ (İYS kapsam dışı): link panelde kopyalanır; müşterinin
 * danışmanına "linki iletin" bildirimi düşer. unique(deal_id) mükerrer
 * üretimi DB seviyesinde engeller (23505 → dostane mesaj).
 */
export async function createSurveyForDeal(formData: FormData): Promise<SurveyResult> {
  const gate = await requirePermission("reports", "view");
  if (!gate.ok) return { error: gate.error };
  const dealsGate = await requirePermission("commissions", "view");
  if (!dealsGate.ok) return { error: dealsGate.error };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!UUID_RE.test(dealId)) return { error: "Geçersiz anlaşma." };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage, customer_id, assigned_to")
    .eq("id", dealId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!deal) return { error: "Anlaşma bulunamadı." };
  if (deal.stage !== "won") return { error: "Anket yalnızca kazanılan anlaşmalar için oluşturulabilir." };
  if (!deal.customer_id) return { error: "Anlaşmaya bağlı müşteri yok — anket gönderilecek kişi belirsiz." };

  const [{ data: customer }, { data: agent }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("id", deal.customer_id)
      .eq("tenant_id", gate.tenantId)
      .is("deleted_at", null)
      .maybeSingle(),
    deal.assigned_to
      ? supabase
          .from("profiles")
          .select("id")
          .eq("id", deal.assigned_to)
          .eq("tenant_id", gate.tenantId)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!customer) return { error: "Anlaşmanın müşterisi bulunamadı veya bu ofise ait değil." };
  if (deal.assigned_to && !agent) return { error: "Anlaşmanın danışmanı bu ofise ait değil." };

  const { data, error } = await supabase
    .from("surveys")
    .insert({
      tenant_id: gate.tenantId,
      deal_id: deal.id,
      customer_id: customer.id,
      agent_id: agent?.id ?? null,
    })
    .select("id, public_token")
    .single();

  if (error || !data) {
    // unique(deal_id) ihlali — bir anlaşmaya bir anket.
    if (error?.code === "23505") return { error: "Bu anlaşma için zaten bir anket oluşturulmuş." };
    console.error("createSurveyForDeal", error);
    return { error: actionErrorMessage(error, "Anket oluşturulamadı.") };
  }

  const url = `${appUrl()}/anket/${data.public_token}`;

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.create",
    entityType: "survey",
    entityId: data.id,
    newValue: { deal_id: deal.id, customer_id: deal.customer_id },
  });

  // Müşterinin danışmanına haber ver — linki müşteriye o iletecek.
  const customerName = customer.full_name ?? "müşteri";
  const agentId = agent?.id ?? null;
  if (agentId) {
    try {
      await notifyTenant({
        tenantId: gate.tenantId,
        userId: agentId,
        title: "Anket linki hazır — müşteriye iletin",
        body: `${customerName} için memnuniyet anketi oluşturuldu. Linki raporlar sayfasından kopyalayabilirsiniz.`,
        href: "/app/raporlar/memnuniyet",
        kind: "info",
      });
    } catch (e) {
      console.error("createSurveyForDeal notify", e);
    }
  }

  revalidatePath("/app/raporlar/memnuniyet");
  return { ok: true, id: data.id, url };
}

/* ====================================================================
 * ANKET MODÜLÜ (anketör kuyruğu) — yukarıdaki kapanış anketi AYNEN kalır.
 * Yapılandırma (tetikleyici, şablon, ayar, anketör ataması) `surveys` modülünde SİLME düzeyi izin ister
 * (varsayılan: ofis sahibi ve genel müdür); kuyruk işlemleri anketör ataması veya yönetici yetkisiyle yapılır.
 * ==================================================================== */

export type SurveyOpResult = { ok?: boolean; error?: string; message?: string };

const SURVEYS_HREF = "/app/anketler";

function revalidateSurveys() {
  revalidatePath(SURVEYS_HREF);
  revalidatePath(`${SURVEYS_HREF}/kuyruk`);
  revalidatePath(`${SURVEYS_HREF}/ayarlar`);
}

function schemaError(error: { code?: string | null; message?: string | null } | null, fallback: string): string {
  if (isSurveySchemaMissing(error)) return "Anket modülü bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).";
  return actionErrorMessage(error, fallback);
}

/** Tetikleyiciyi aç/kapat; bekleme günü ve en çok deneme sayısı. Açılış anı kaydedilir (geriye dönük anket yok). */
export async function saveSurveyTrigger(input: {
  event: string;
  enabled: boolean;
  delayDays: number;
  maxAttempts: number;
}): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isSurveyEventType(input.event)) return { error: "Geçersiz olay türü." };
  const delay = Math.trunc(Number(input.delayDays));
  const attempts = Math.trunc(Number(input.maxAttempts));
  if (!Number.isFinite(delay) || delay < 0 || delay > 60) return { error: "Bekleme süresi 0 ile 60 gün arasında olmalı." };
  if (!Number.isFinite(attempts) || attempts < 1 || attempts > 10) return { error: "Deneme sayısı 1 ile 10 arasında olmalı." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("survey_triggers")
    .select("enabled, enabled_since")
    .eq("tenant_id", gate.tenantId)
    .eq("event_type", input.event)
    .maybeSingle();
  const nowIso = new Date().toISOString();
  // Kapalıdan açığa geçişte (ya da hiç açılmamışsa) açılış anı yenilenir.
  const since = input.enabled
    ? existing?.enabled && existing.enabled_since
      ? (existing.enabled_since as string)
      : nowIso
    : ((existing?.enabled_since as string | null | undefined) ?? null);
  const { error } = await supabase.from("survey_triggers").upsert(
    {
      tenant_id: gate.tenantId,
      event_type: input.event,
      enabled: input.enabled === true,
      delay_days: delay,
      max_attempts: attempts,
      enabled_since: since,
      updated_by: gate.userId,
      updated_at: nowIso,
    },
    { onConflict: "tenant_id,event_type" },
  );
  if (error) return { error: schemaError(error, "Tetikleyici kaydedilemedi.") };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.trigger",
    entityType: "survey_trigger",
    entityId: gate.tenantId,
    newValue: { event: input.event, enabled: input.enabled, delay, attempts },
  });
  revalidateSurveys();
  return { ok: true };
}

/**
 * Atama modu, gecikme eşiği, yeniden deneme saati, düşük puan sınırı; otomatik gönderim (SMS/WhatsApp) ve destekleyene
 * tavsiye daveti. Gönderim sütunları yoksa (PB49 uygulanmadı) yalnız temel ayarlar yazılır ve bu açıkça söylenir.
 */
export async function saveSurveySettings(input: {
  assignmentMode: string;
  fixedAssignee: string | null;
  overdueHours: number;
  retryHours: number;
  lowScoreMax: number;
  autoSend?: boolean;
  whatsappTemplate?: string | null;
  whatsappLanguage?: string;
  promoterInvite?: boolean;
}): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!(SURVEY_ASSIGNMENT_MODES as readonly string[]).includes(input.assignmentMode)) return { error: "Geçersiz atama modu." };
  const mode = input.assignmentMode as SurveyAssignmentMode;
  const overdue = Math.trunc(Number(input.overdueHours));
  const retry = Math.trunc(Number(input.retryHours));
  const low = Math.trunc(Number(input.lowScoreMax));
  if (!(overdue >= 1 && overdue <= 720)) return { error: "Gecikme eşiği 1 ile 720 saat arasında olmalı." };
  if (!(retry >= 1 && retry <= 336)) return { error: "Yeniden deneme aralığı 1 ile 336 saat arasında olmalı." };
  if (!(low >= 1 && low <= 9)) return { error: "Düşük puan sınırı 1 ile 9 arasında olmalı." };

  const supabase = await createClient();
  let fixed: string | null = null;
  if (mode === "selected") {
    const assignees = await loadAssigneeIds(supabase, gate.tenantId);
    if (!input.fixedAssignee || !assignees.includes(input.fixedAssignee)) {
      return { error: "Seçili anketör, atanmış anketörler arasında olmalı." };
    }
    fixed = input.fixedAssignee;
  }
  const template = String(input.whatsappTemplate ?? "").trim();
  if (template && !WA_TEMPLATE_RE.test(template)) {
    return { error: "WhatsApp şablon adı yalnız küçük harf, rakam ve alt çizgi içerebilir (Meta'da onaylı şablon adı)." };
  }
  const language = String(input.whatsappLanguage ?? "tr").trim() || "tr";
  if (!WA_LANG_RE.test(language)) return { error: "WhatsApp şablon dili geçersiz (ör. tr veya en_US)." };

  const base = {
    tenant_id: gate.tenantId,
    assignment_mode: mode,
    fixed_assignee: fixed,
    overdue_hours: overdue,
    retry_hours: retry,
    low_score_max: low,
    updated_by: gate.userId,
    updated_at: new Date().toISOString(),
  };
  const v2 = {
    ...base,
    auto_send: input.autoSend === true,
    whatsapp_template: template || null,
    whatsapp_language: language,
    promoter_invite: input.promoterInvite !== false,
  };
  let { error } = await supabase.from("survey_settings").upsert(v2, { onConflict: "tenant_id" });
  let legacyOnly = false;
  if (error && isMissingColumn(error)) {
    legacyOnly = true;
    ({ error } = await supabase.from("survey_settings").upsert(base, { onConflict: "tenant_id" }));
  }
  if (error) return { error: schemaError(error, "Ayarlar kaydedilemedi.") };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.settings",
    entityType: "survey_settings",
    entityId: gate.tenantId,
    newValue: legacyOnly ? { mode, overdue, retry, low } : { mode, overdue, retry, low, auto_send: v2.auto_send, whatsapp_template: v2.whatsapp_template, promoter_invite: v2.promoter_invite },
  });
  revalidateSurveys();
  return legacyOnly
    ? { ok: true, message: "Temel ayarlar kaydedildi. Otomatik gönderim ve tavsiye daveti veritabanı güncellemesinden sonra etkinleşir." }
    : { ok: true };
}

/**
 * Kitle × tetik matrisi: bir olayın bir kitlesini aç/kapa (o şablonun `active` bayrağı). Kapalı kitleye anket üretilmez;
 * şablon ve geçmiş cevaplar korunur.
 */
export async function setSurveyAudienceEnabled(input: { event: string; audience: string; enabled: boolean }): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!isSurveyEventType(input.event) || !isSurveyAudience(input.audience) || !isValidEventAudience(input.event, input.audience)) {
    return { error: "Geçersiz olay veya kitle." };
  }
  const supabase = await createClient();
  await ensureSurveyDefaults(supabase, gate.tenantId);
  const { data, error } = await supabase
    .from("survey_templates")
    .update({ active: input.enabled === true, updated_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId)
    .eq("event_type", input.event)
    .eq("audience", input.audience)
    .select("id")
    .maybeSingle();
  if (error) return { error: schemaError(error, "Kitle ayarı kaydedilemedi.") };
  if (!data) return { error: "Bu olay için şablon henüz oluşturulamadı (veritabanı güncellemesi bekleniyor olabilir)." };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.audience",
    entityType: "survey_template",
    entityId: String(data.id),
    newValue: { event: input.event, audience: input.audience, enabled: input.enabled === true },
  });
  revalidateSurveys();
  return { ok: true };
}

/**
 * Düşük puan takibini aksiyon notuyla kapatır (zincirin son halkası). Yetki DB'de (`survey_close_low_score`, JWT kimlikli):
 * yönetici, ilgili danışman, takip görevinin atananı veya danışmanın takım lideri. Takip görevi aynı işlemde "tamamlandı" olur.
 */
export async function closeLowScoreFollowUp(taskId: string, note: string): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  const text = String(note ?? "").trim();
  if (!validLowScoreNote(text)) return { error: `Aksiyon notu en az ${LOW_SCORE_NOTE_MIN} karakter olmalı (ne yapıldığını yazın).` };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("survey_close_low_score", { p_task_id: taskId, p_note: text });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "Düşük puan kapanışı veritabanı güncellemesinden sonra etkinleşir." };
    return { error: schemaError(error, "Takip kapatılamadı.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (!res.ok) {
    const messages: Record<string, string> = {
      note_required: `Aksiyon notu en az ${LOW_SCORE_NOTE_MIN} karakter olmalı.`,
      forbidden: "Bu takibi yalnız ilgili danışman, takım lideri, görevin sahibi veya yönetici kapatabilir.",
      already: "Bu takip zaten kapatılmış.",
      not_found: "Anket görevi bulunamadı.",
      invalid: "Bu anket için düşük puan takibi yok.",
      unauthorized: SESSION_EXPIRED_MESSAGE,
    };
    return { error: messages[res.code ?? ""] ?? actionErrorMessage(null, "Takip kapatılamadı.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.low_score_close",
    entityType: "survey_task",
    entityId: taskId,
    newValue: { note_length: text.length },
  });
  revalidateSurveys();
  revalidatePath("/app/gorevler");
  return { ok: true, message: "Takip aksiyon notuyla kapatıldı." };
}

/**
 * Ekip nabzı cevabı (danışman iç anketi). ANONİM: cevap satırı kişiye bağlanmaz (RPC), bu yüzden etkinlik günlüğüne
 * KİŞİ + ZAMAN kaydı da yazılmaz (yazılırsa cevapla eşleştirilebilirdi). Ayda bir kural DB'de (`survey_pulse_responses`).
 */
export async function submitAdvisorPulse(answers: Record<string, string>): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!(await isModuleEnabled(gate.tenantId, "surveys"))) return { error: "Anketler modülü bu ofiste kapalı." };
  if (!pulseEligibleRole(gate.role)) return { error: "Ekip nabzı ofis sahibi ve genel müdür dışındaki ekip içindir." };
  const supabase = await createClient();
  const state = await loadPulseFormState(supabase, gate.tenantId, gate.userId, now());
  if (state.state === "answered") return { error: "Bu ayın anketini zaten cevapladınız. Teşekkürler!" };
  if (state.state !== "open") return { error: "Ekip nabzı şu an açık değil." };
  const check = validateAnswers(state.questions, answers && typeof answers === "object" ? answers : {});
  if (!check.ok) return { error: check.error };
  const payload = check.answers.map((a) => ({ question_id: a.question_id, value_num: a.value_num, value_text: a.value_text }));
  const { data, error } = await supabase.rpc("survey_submit_advisor_pulse", { p_template_id: state.templateId, p_period: state.period, p_answers: payload });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "Ekip nabzı veritabanı güncellemesinden sonra etkinleşir." };
    return { error: schemaError(error, "Cevap kaydedilemedi.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (!res.ok) {
    const messages: Record<string, string> = {
      already: "Bu ayın anketini zaten cevapladınız. Teşekkürler!",
      disabled: "Ekip nabzı şu an kapalı.",
      period: "Dönem değişti; sayfayı yenileyip tekrar deneyin.",
      required: "Zorunlu soruları cevaplayın.",
    };
    return { error: messages[res.code ?? ""] ?? actionErrorMessage(null, "Cevap kaydedilemedi.") };
  }
  revalidatePath(`${SURVEYS_HREF}/ic-anket`);
  return { ok: true, message: "Teşekkürler! Cevabınız anonim olarak kaydedildi." };
}

/** Kullanıcıyı anketör yapar / görevden alır (rol değişmez). */
export async function setSurveyAssignee(userId: string, on: boolean): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(userId)) return { error: "Geçersiz kullanıcı." };
  const supabase = await createClient();
  if (on) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .eq("tenant_id", gate.tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (!profile) return { error: "Kullanıcı bu ofise ait değil veya pasif." };
    const { error } = await supabase
      .from("survey_assignees")
      .upsert({ tenant_id: gate.tenantId, user_id: userId, created_by: gate.userId }, { onConflict: "tenant_id,user_id", ignoreDuplicates: true });
    if (error) return { error: schemaError(error, "Anketör atanamadı.") };
  } else {
    const { error } = await supabase.from("survey_assignees").delete().eq("tenant_id", gate.tenantId).eq("user_id", userId);
    if (error) return { error: schemaError(error, "Anketör görevden alınamadı.") };
    // Görevden alınan anketörün bekleyen işleri atanmamışa döner (yönetici yeniden dağıtır).
    await supabase.from("survey_tasks").update({ assigned_to: null }).eq("tenant_id", gate.tenantId).eq("assigned_to", userId).eq("status", "pending");
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: on ? "survey.assignee_add" : "survey.assignee_remove",
    entityType: "survey_assignee",
    entityId: userId,
  });
  revalidateSurveys();
  return { ok: true };
}

/** Şablonu (ad, aktiflik, sorular) kaydeder. Mevcut soru kimlikleri korunur; kaldırılan sorunun eski cevapları metniyle kalır. */
export async function saveSurveyTemplate(input: {
  templateId: string;
  name: string;
  active: boolean;
  questions: unknown;
}): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "delete");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(input.templateId)) return { error: "Geçersiz şablon." };
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (name.length < 2) return { error: "Şablon adı en az 2 karakter olmalı." };
  const drafts = sanitizeQuestionDrafts(input.questions);
  if ("error" in drafts) return { error: drafts.error };

  const supabase = await createClient();
  const { data: tpl } = await supabase
    .from("survey_templates")
    .select("id")
    .eq("id", input.templateId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!tpl) return { error: "Şablon bulunamadı." };

  const { data: existing } = await supabase
    .from("survey_questions")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("template_id", tpl.id);
  const existingIds = new Set((existing ?? []).map((q) => String(q.id)));
  const keepIds = new Set(drafts.filter((q) => q.id && existingIds.has(q.id)).map((q) => q.id as string));

  for (let i = 0; i < drafts.length; i++) {
    const q = drafts[i]!;
    const row = { position: i, kind: q.kind, label: q.label, options: q.options, required: q.required, tag: q.tag };
    if (q.id && existingIds.has(q.id)) {
      const { error } = await supabase.from("survey_questions").update(row).eq("id", q.id).eq("tenant_id", gate.tenantId);
      if (error) return { error: schemaError(error, "Sorular kaydedilemedi.") };
    } else {
      const { error } = await supabase.from("survey_questions").insert({ ...row, tenant_id: gate.tenantId, template_id: tpl.id });
      if (error) return { error: schemaError(error, "Sorular kaydedilemedi.") };
    }
  }
  const removed = [...existingIds].filter((id) => !keepIds.has(id));
  if (removed.length > 0) {
    await supabase.from("survey_questions").delete().eq("tenant_id", gate.tenantId).in("id", removed);
  }
  const { error } = await supabase
    .from("survey_templates")
    .update({ name, active: input.active === true, updated_at: new Date().toISOString() })
    .eq("id", tpl.id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: schemaError(error, "Şablon kaydedilemedi.") };
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.template",
    entityType: "survey_template",
    entityId: tpl.id,
    newValue: { name, questions: drafts.length },
  });
  revalidateSurveys();
  return { ok: true };
}

/** Görevi bir anketöre atar (boş = atamayı kaldır). Yalnız yönetici. */
export async function assignSurveyTask(taskId: string, userId: string | null): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId) || (userId !== null && !UUID_RE.test(userId))) return { error: "Geçersiz istek." };
  const supabase = await createClient();
  if (userId) {
    const assignees = await loadAssigneeIds(supabase, gate.tenantId);
    if (!assignees.includes(userId)) return { error: "Seçilen kişi anketör olarak atanmamış." };
  }
  const { data, error } = await supabase
    .from("survey_tasks")
    .update({ assigned_to: userId })
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: schemaError(error, "Atama yapılamadı.") };
  if (!data) return { error: "Görev bulunamadı veya artık bekleyen durumda değil." };
  await supabase
    .from("survey_attempts")
    .insert({ tenant_id: gate.tenantId, task_id: taskId, user_id: gate.userId, outcome: "reassigned", note: userId ? "yeniden atandı" : "atama kaldırıldı" });
  revalidateSurveys();
  return { ok: true };
}

/** Atanmamış bekleyen görevleri anketörlere dengeli dağıtır. */
export async function distributeSurveyTasks(): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "edit");
  if (!gate.ok) return { error: gate.error };
  const supabase = await createClient();
  const [assignees, load, { data: open }] = await Promise.all([
    loadAssigneeIds(supabase, gate.tenantId),
    loadOpenLoad(supabase, gate.tenantId),
    supabase
      .from("survey_tasks")
      .select("id")
      .eq("tenant_id", gate.tenantId)
      .eq("status", "pending")
      .is("assigned_to", null)
      .order("due_at")
      .limit(500),
  ]);
  if (assignees.length === 0) return { error: "Önce Ayarlar bölümünden en az bir anketör atayın." };
  let n = 0;
  for (const t of open ?? []) {
    const who = pickBalancedAssignee(assignees, load);
    if (!who) break;
    const { error } = await supabase
      .from("survey_tasks")
      .update({ assigned_to: who })
      .eq("id", t.id)
      .eq("tenant_id", gate.tenantId)
      .is("assigned_to", null);
    if (error) continue;
    load.set(who, (load.get(who) ?? 0) + 1);
    n += 1;
  }
  revalidateSurveys();
  return { ok: true, message: n === 0 ? "Dağıtılacak atanmamış görev yok." : `${n} görev dengeli dağıtıldı.` };
}

/** Bekleyen görevi iptal eder (ör. artık anlamsız). Yalnız yönetici. */
export async function cancelSurveyTask(taskId: string): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("survey_tasks")
    .update({ status: "cancelled", next_attempt_at: null })
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: schemaError(error, "Görev iptal edilemedi.") };
  if (!data) return { error: "Görev bulunamadı veya artık bekleyen durumda değil." };
  revalidateSurveys();
  return { ok: true };
}

type TaskRow = CompletableTask & { assigned_to: string | null; max_attempts: number; status: string; template_id: string | null };

async function loadWorkableTask(taskId: string, tenantId: string, userId: string, access: { canManage: boolean }) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("survey_tasks")
    .select("id, tenant_id, event_type, audience, customer_id, property_id, deal_id, agent_id, contact_name, attempts, assigned_to, max_attempts, status, template_id")
    .eq("id", taskId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!task) return { error: "Görev bulunamadı." } as const;
  if (!canWorkTask(access, userId, (task.assigned_to as string | null) ?? null)) {
    return { error: "Bu görev size atanmamış." } as const;
  }
  return { supabase, task: task as TaskRow } as const;
}

/**
 * Arama sonucunu kaydeder: açmadı/meşgul (otomatik yeniden planlama, en çok N deneme), yanlış numara, reddetti.
 * "Tamamlandı" `completeSurveyByPhone` ile cevaplarla birlikte kaydedilir.
 */
export async function logSurveyAttempt(taskId: string, outcome: string, note?: string): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  if (outcome !== "no_answer" && outcome !== "busy" && outcome !== "wrong_number" && outcome !== "refused") {
    return { error: "Geçersiz arama sonucu." };
  }
  const supabase0 = await createClient();
  const access = await resolveWorkerAccess(supabase0, gate);
  if (!access.ok) return { error: access.error };
  const loaded = await loadWorkableTask(taskId, gate.tenantId, gate.userId, access);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, task } = loaded;
  if (task.status !== "pending") return { error: "Görev artık bekleyen durumda değil." };

  const settings = await loadSurveySettings(supabase, gate.tenantId);
  const result = applyAttemptOutcome(outcome, { attempts: task.attempts, maxAttempts: task.max_attempts }, Date.now(), settings.retry_hours);
  const { data, error } = await supabase
    .from("survey_tasks")
    .update({
      status: result.status,
      attempts: result.attempts,
      next_attempt_at: result.nextAttemptAt,
      last_outcome: result.lastOutcome,
    })
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: schemaError(error, "Arama sonucu kaydedilemedi.") };
  if (!data) return { error: "Görev az önce başka biri tarafından güncellendi." };
  await supabase.from("survey_attempts").insert({
    tenant_id: gate.tenantId,
    task_id: taskId,
    user_id: gate.userId,
    outcome: outcome as SurveyOutcome,
    note: (note ?? "").trim().slice(0, 500) || null,
  });
  revalidateSurveys();
  const message =
    result.status === "pending"
      ? `${settings.retry_hours} saat sonrasına yeniden planlandı (deneme ${result.attempts}/${task.max_attempts}).`
      : result.status === "refused"
        ? "Müşteri anketi reddetti olarak kapatıldı."
        : "Ulaşılamadı olarak kapatıldı.";
  return { ok: true, message };
}

/** Arama sırasında doldurulan soru-cevap formunu kaydedip görevi tamamlar. `answers`: soru kimliği -> cevap. */
export async function completeSurveyByPhone(taskId: string, answers: Record<string, string>): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  const supabase0 = await createClient();
  const access = await resolveWorkerAccess(supabase0, gate);
  if (!access.ok) return { error: access.error };
  const loaded = await loadWorkableTask(taskId, gate.tenantId, gate.userId, access);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, task } = loaded;
  if (task.status !== "pending") return { error: "Görev artık bekleyen durumda değil." };
  if (!task.template_id) return { error: "Görevin şablonu bulunamadı." };

  const questions = await loadTemplateQuestions(supabase, gate.tenantId, task.template_id);
  const check = validateAnswers(questions, answers && typeof answers === "object" ? answers : {});
  if (!check.ok) return { error: check.error };

  let customerName = task.contact_name ?? "";
  if (task.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("full_name")
      .eq("id", task.customer_id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (c?.full_name) customerName = String(c.full_name);
  }
  const settings = await loadSurveySettings(supabase, gate.tenantId);
  try {
    const result = await completeSurveyTask(supabase, task, {
      answers: check.answers,
      score: check.score,
      comment: check.comment,
      via: "phone",
      userId: gate.userId,
      settings,
      customerName,
    });
    if (!result.done) return { error: "Görev az önce başka biri tarafından kapatıldı." };
  } catch {
    return { error: actionErrorMessage(null, "Cevaplar kaydedilemedi. Lütfen tekrar deneyin.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "survey.complete",
    entityType: "survey_task",
    entityId: taskId,
    newValue: { event: task.event_type, score: check.score },
  });
  revalidateSurveys();
  return { ok: true, message: "Anket kaydedildi." };
}

/** Müşteri kaydı olmayan muhatabın (ör. malik) adını ve telefonunu günceller; telefon sıkı doğrulanır. */
export async function updateSurveyTaskContact(taskId: string, name: string, phone: string): Promise<SurveyOpResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  const supabase0 = await createClient();
  const access = await resolveWorkerAccess(supabase0, gate);
  if (!access.ok) return { error: access.error };
  const loaded = await loadWorkableTask(taskId, gate.tenantId, gate.userId, access);
  if ("error" in loaded) return { error: loaded.error };
  const { supabase, task } = loaded;
  if (task.customer_id) return { error: "Müşteri kayıtlı görevlerde iletişim bilgisi müşteri kartından düzenlenir." };
  const cleanName = String(name ?? "").trim().slice(0, 120);
  const parsed = parsePhoneStrict(phone);
  if (!parsed.ok) return { error: parsed.error ?? "Geçerli bir telefon numarası girin." };
  const { error } = await supabase
    .from("survey_tasks")
    .update({ contact_name: cleanName || null, contact_phone: parsed.stored })
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: schemaError(error, "İletişim bilgisi kaydedilemedi.") };
  revalidateSurveys();
  return { ok: true };
}

/** Görev için müşteriye iletilecek bağlı anket adresi (SMS gönderilmez; panelde kopyalanır). */
export async function getSurveyTaskLink(taskId: string): Promise<SurveyResult> {
  const gate = await requirePermission("surveys", "view");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(taskId)) return { error: "Geçersiz görev." };
  const supabase = await createClient();
  const access = await resolveWorkerAccess(supabase, gate);
  if (!access.ok) return { error: access.error };
  const { data } = await supabase
    .from("survey_tasks")
    .select("public_token, assigned_to")
    .eq("id", taskId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!data) return { error: "Görev bulunamadı." };
  if (!canWorkTask(access, gate.userId, (data.assigned_to as string | null) ?? null)) return { error: "Bu görev size atanmamış." };
  return { ok: true, url: `${appUrl()}/anket/${data.public_token}` };
}
