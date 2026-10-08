import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { notifyTenant } from "@/lib/notify";
import { getBaseUrl } from "@/lib/base-url";
import { isFeatureEnabledIn } from "@/lib/modules/logic";
import { loadTenantModuleState } from "@/lib/modules/state";
import { dueAtFor, isLowScore, isPromoter, resolveAssignee, type StoredQuestion, type ValidAnswer } from "@/lib/surveys/logic";
import { DEFAULT_TEMPLATES } from "@/lib/surveys/defaults";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_SURVEY_SETTINGS,
  EVENT_DEFAULT_DELAY_DAYS,
  SURVEY_EVENT_TYPES,
  isSurveyEventType,
  type SurveyAudience,
  type SurveyEventType,
  type SurveySettings,
} from "@/lib/surveys/types";

/**
 * Anket modülünün sunucu yardımcıları. Her fonksiyon çağıranın verdiği Supabase client'ı ile çalışır:
 * oturumlu action'larda RLS'li kullanıcı client'ı, cron ve public bağlantıda service role.
 * Tablolar yokken (migration uygulanmadı) hiçbir yardımcı fırlatmaz; `isSurveyModuleReady` false döner.
 * 20261007000400 (PB49) yokken yeni sütunlar/olaylar sessizce atlanır (eski davranış).
 */

/** PB49 ile gelen olaylar: migration yokken CHECK reddeder, bu yüzden ayrı yazılır. */
const V2_EVENTS: readonly SurveyEventType[] = ["rent_renewal", "tenant_annual", "advisor_pulse"];

export function isSurveySchemaMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("survey_") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
}

/** Sütun yok (PB49 uygulanmadı) hatası mı? */
export function isMissingColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

/** Anket tabloları veritabanında var mı? Yoksa modül "etkin değil" uyarısıyla gizlenir. */
export async function isSurveyModuleReady(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("survey_tasks").select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (isSurveySchemaMissing(error)) return false;
  console.error("survey_tasks hazırlık denetimi", error.message);
  return false;
}

const BASE_SETTINGS_COLS = "assignment_mode, fixed_assignee, overdue_hours, retry_hours, low_score_max";
const V2_SETTINGS_COLS = `${BASE_SETTINGS_COLS}, auto_send, whatsapp_template, whatsapp_language, promoter_invite`;

/** Satır → ayar (saf). Sütun yoksa varsayılan. */
export function parseSurveySettings(data: Record<string, unknown> | null | undefined): SurveySettings {
  if (!data) return { ...DEFAULT_SURVEY_SETTINGS };
  const mode = data.assignment_mode === "selected" || data.assignment_mode === "manual" ? data.assignment_mode : "balanced";
  const template = typeof data.whatsapp_template === "string" && data.whatsapp_template.trim() ? data.whatsapp_template.trim() : null;
  return {
    assignment_mode: mode,
    fixed_assignee: (data.fixed_assignee as string | null) ?? null,
    overdue_hours: Number(data.overdue_hours) || DEFAULT_SURVEY_SETTINGS.overdue_hours,
    retry_hours: Number(data.retry_hours) || DEFAULT_SURVEY_SETTINGS.retry_hours,
    low_score_max: Number(data.low_score_max) || DEFAULT_SURVEY_SETTINGS.low_score_max,
    auto_send: data.auto_send === true,
    whatsapp_template: template,
    whatsapp_language: typeof data.whatsapp_language === "string" && data.whatsapp_language ? data.whatsapp_language : "tr",
    promoter_invite: data.promoter_invite === undefined ? DEFAULT_SURVEY_SETTINGS.promoter_invite : data.promoter_invite === true,
  };
}

export async function loadSurveySettings(db: SupabaseClient, tenantId: string): Promise<SurveySettings> {
  const first = await db.from("survey_settings").select(V2_SETTINGS_COLS).eq("tenant_id", tenantId).maybeSingle();
  if (!first.error) return parseSurveySettings(first.data as Record<string, unknown> | null);
  if (!isMissingColumn(first.error)) return { ...DEFAULT_SURVEY_SETTINGS };
  const legacy = await db.from("survey_settings").select(BASE_SETTINGS_COLS).eq("tenant_id", tenantId).maybeSingle();
  return parseSurveySettings(legacy.data as Record<string, unknown> | null);
}

export async function loadAssigneeIds(db: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: rows } = await db.from("survey_assignees").select("user_id").eq("tenant_id", tenantId);
  const ids = (rows ?? []).map((r) => String(r.user_id));
  if (ids.length === 0) return [];
  // Pasife alınan kullanıcı anketör kalamaz.
  const { data: active } = await db.from("profiles").select("id").eq("tenant_id", tenantId).eq("is_active", true).in("id", ids);
  return (active ?? []).map((p) => String(p.id));
}

/** Her anketörün açık (bekleyen) görev sayısı. */
export async function loadOpenLoad(db: SupabaseClient, tenantId: string): Promise<Map<string, number>> {
  const { data } = await fetchAllRows((from, to) =>
    db
      .from("survey_tasks")
      .select("assigned_to")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .not("assigned_to", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const load = new Map<string, number>();
  for (const r of data ?? []) {
    const id = String(r.assigned_to);
    load.set(id, (load.get(id) ?? 0) + 1);
  }
  return load;
}

type QuestionRow = {
  tenant_id: string;
  template_id: string;
  position: number;
  kind: string;
  label: string;
  options: string[];
  required: boolean;
  tag: string | null;
};

async function insertQuestions(db: SupabaseClient, rows: QuestionRow[]) {
  if (rows.length === 0) return;
  const { error } = await db.from("survey_questions").insert(rows);
  if (!error) return;
  // PB49 yokken `advisor` etiketi CHECK'e takılır: etiketsiz yeniden dene (soru yine eklenir).
  if (error.code === "23514") {
    const { error: retry } = await db.from("survey_questions").insert(rows.map((r) => (r.tag === "advisor" ? { ...r, tag: null } : r)));
    if (retry) console.error("ensureSurveyDefaults sorular", retry.message);
    return;
  }
  console.error("ensureSurveyDefaults sorular", error.message);
}

async function ensureDefaultsFor(db: SupabaseClient, tenantId: string, events: readonly SurveyEventType[]): Promise<void> {
  const { error: trigErr } = await db.from("survey_triggers").upsert(
    events.map((event_type) => ({
      tenant_id: tenantId,
      event_type,
      enabled: false,
      delay_days: EVENT_DEFAULT_DELAY_DAYS[event_type],
      max_attempts: DEFAULT_MAX_ATTEMPTS,
    })),
    { onConflict: "tenant_id,event_type", ignoreDuplicates: true },
  );
  if (trigErr && trigErr.code !== "23514") console.error("ensureSurveyDefaults tetikleyici", trigErr.message);

  const defs = DEFAULT_TEMPLATES.filter((t) => events.includes(t.event));
  const { data: inserted, error } = await db
    .from("survey_templates")
    .upsert(
      defs.map((t) => ({ tenant_id: tenantId, event_type: t.event, audience: t.audience, name: t.name })),
      { onConflict: "tenant_id,event_type,audience", ignoreDuplicates: true },
    )
    .select("id, event_type, audience");
  if (error) {
    // 23514: yeni olaylar için CHECK (PB49 uygulanmadı) — beklenen, sessiz.
    if (error.code !== "23514") console.error("ensureSurveyDefaults şablon", error.message);
    return;
  }
  // Yalnız bu çağrıda YENİ doğan şablonların soruları eklenir (mevcut şablon düzenlemesi korunur).
  const rows: QuestionRow[] = (inserted ?? []).flatMap((tpl) => {
    const def = defs.find((d) => d.event === tpl.event_type && d.audience === tpl.audience);
    if (!def) return [];
    return def.questions.map((q, position) => ({
      tenant_id: tenantId,
      template_id: String(tpl.id),
      position,
      kind: q.kind,
      label: q.label,
      options: q.options,
      required: q.required,
      tag: q.tag,
    }));
  });
  await insertQuestions(db, rows);
}

/**
 * Eksik varsayılan şablon ve tetikleyici satırlarını oluşturur (idempotent; mevcut satıra dokunmaz).
 * Tetikleyiciler KAPALI doğar: ofis sahibi tek tek açar. Yeni olaylar (PB49) ayrı turda yazılır ki migration
 * yokken eski olayların kurulumu bozulmasın.
 */
export async function ensureSurveyDefaults(db: SupabaseClient, tenantId: string): Promise<void> {
  await ensureDefaultsFor(db, tenantId, SURVEY_EVENT_TYPES.filter((e) => !V2_EVENTS.includes(e)));
  await ensureDefaultsFor(db, tenantId, V2_EVENTS);
}

export async function loadTemplateQuestions(db: SupabaseClient, tenantId: string, templateId: string): Promise<StoredQuestion[]> {
  const { data } = await db
    .from("survey_questions")
    .select("id, kind, label, options, required, tag, position")
    .eq("tenant_id", tenantId)
    .eq("template_id", templateId)
    .order("position", { ascending: true });
  return (data ?? []).map((q) => ({
    id: String(q.id),
    kind: q.kind as StoredQuestion["kind"],
    label: String(q.label),
    options: Array.isArray(q.options) ? (q.options as unknown[]).map(String) : [],
    required: q.required === true,
    tag: (q.tag as string | null) ?? null,
  }));
}

/* ------------------------------------------------------------ görev üretimi */

export type EventCandidate = {
  eventType: SurveyEventType;
  audience: SurveyAudience;
  eventKey: string;
  summary: string;
  eventAt: string;
  customerId?: string | null;
  propertyId?: string | null;
  dealId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  agentId?: string | null;
};

export type TriggerRow = { event_type: SurveyEventType; enabled: boolean; delay_days: number; max_attempts: number; enabled_since: string | null };

export async function loadTriggers(db: SupabaseClient, tenantId: string): Promise<TriggerRow[]> {
  const { data } = await db
    .from("survey_triggers")
    .select("event_type, enabled, delay_days, max_attempts, enabled_since")
    .eq("tenant_id", tenantId);
  return (data ?? []).filter((r) => isSurveyEventType(r.event_type)) as TriggerRow[];
}

export async function loadActiveTemplateMap(db: SupabaseClient, tenantId: string): Promise<Map<string, string>> {
  const { data } = await db.from("survey_templates").select("id, event_type, audience").eq("tenant_id", tenantId).eq("active", true);
  const map = new Map<string, string>();
  for (const t of data ?? []) map.set(`${t.event_type}:${t.audience}`, String(t.id));
  return map;
}

/**
 * Adayları görev olarak yazar. Zaten var olan olay anahtarları atlanır (mükerrer anket yok);
 * yarışta ikinci yazım `unique(tenant_id, event_key)` ile DB tarafında da engellenir.
 * Kitle kapalıysa (şablon pasif) aday atlanır. Döner: gerçekten yazılan görev sayısı.
 */
export async function insertCandidates(
  db: SupabaseClient,
  tenantId: string,
  trigger: TriggerRow,
  candidates: readonly EventCandidate[],
  ctx: { settings: SurveySettings; assigneeIds: string[]; load: Map<string, number>; templates: Map<string, string> },
): Promise<number> {
  if (candidates.length === 0) return 0;
  const keys = candidates.map((c) => c.eventKey);
  const existing = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db.from("survey_tasks").select("event_key").eq("tenant_id", tenantId).in("event_key", keys.slice(i, i + 200));
    for (const r of data ?? []) existing.add(String(r.event_key));
  }
  const rows: Record<string, unknown>[] = [];
  for (const c of candidates) {
    if (existing.has(c.eventKey)) continue;
    const templateId = ctx.templates.get(`${c.eventType}:${c.audience}`);
    if (!templateId) continue; // şablon yok veya pasif (kitle kapalı): anket üretilmez
    const assignee = resolveAssignee(ctx.settings.assignment_mode, ctx.assigneeIds, ctx.settings.fixed_assignee, ctx.load);
    if (assignee) ctx.load.set(assignee, (ctx.load.get(assignee) ?? 0) + 1);
    rows.push({
      tenant_id: tenantId,
      event_type: c.eventType,
      audience: c.audience,
      event_key: c.eventKey,
      event_summary: c.summary.slice(0, 300),
      event_at: c.eventAt,
      template_id: templateId,
      customer_id: c.customerId ?? null,
      property_id: c.propertyId ?? null,
      deal_id: c.dealId ?? null,
      contact_name: c.contactName ?? null,
      contact_phone: c.contactPhone ?? null,
      agent_id: c.agentId ?? null,
      assigned_to: assignee,
      due_at: dueAtFor(c.eventAt, trigger.delay_days),
      max_attempts: trigger.max_attempts,
    });
  }
  if (rows.length === 0) return 0;
  const { data, error } = await db
    .from("survey_tasks")
    .upsert(rows, { onConflict: "tenant_id,event_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("anket görevleri yazılamadı", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** Tek olay için görev (ör. yetki uzatma kancası). Tetikleyici kapalıysa veya hata olursa sessizce 0 döner. */
export async function queueSingleCandidate(db: SupabaseClient, tenantId: string, candidate: EventCandidate): Promise<number> {
  try {
    const triggers = await loadTriggers(db, tenantId);
    const trigger = triggers.find((t) => t.event_type === candidate.eventType);
    if (!trigger || !trigger.enabled) return 0;
    const [settings, assigneeIds, load, templates] = await Promise.all([
      loadSurveySettings(db, tenantId),
      loadAssigneeIds(db, tenantId),
      loadOpenLoad(db, tenantId),
      loadActiveTemplateMap(db, tenantId),
    ]);
    return await insertCandidates(db, tenantId, trigger, [candidate], { settings, assigneeIds, load, templates });
  } catch (e) {
    console.error("queueSingleCandidate", e);
    return 0;
  }
}

/* --------------------------------------------------------------- tamamlama */

export type CompletableTask = {
  id: string;
  tenant_id: string;
  event_type: string;
  audience: string;
  customer_id: string | null;
  property_id: string | null;
  deal_id: string | null;
  agent_id: string | null;
  contact_name: string | null;
  attempts: number;
};

export type CompletionResult = { done: boolean; referralUrl: string | null };

/**
 * Cevapları yazıp görevi tamamlar. Yalnız hâlâ 'pending' görev güncellenir (çift cevap yok).
 * Döner: done=false = görev zaten kapanmış. Düşük puanda "geri arama" takip görevi + danışmana bildirim açılır
 * (kapanmazsa 24 sa takım lideri, 48 sa ofis sahibi: `escalate.ts`); destekleyende (9-10) tavsiye bağlantısı hazırlanır.
 * Kapanış (deal_won) alıcı/kiracı cevabı NPS raporu için mevcut `surveys` tablosuna da yansıtılır.
 */
export async function completeSurveyTask(
  db: SupabaseClient,
  task: CompletableTask,
  input: {
    answers: ValidAnswer[];
    score: number | null;
    comment: string | null;
    via: "phone" | "link";
    userId: string | null;
    settings: SurveySettings;
    customerName: string;
  },
): Promise<CompletionResult> {
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await db
    .from("survey_tasks")
    .update({
      status: "completed",
      score: input.score,
      comment: input.comment,
      answered_via: input.via,
      completed_at: nowIso,
      completed_by: input.userId,
      last_outcome: "completed",
      next_attempt_at: null,
      attempts: input.via === "phone" ? task.attempts + 1 : task.attempts,
    })
    .eq("id", task.id)
    .eq("tenant_id", task.tenant_id)
    // Müşteri bağlı linkle, ulaşılamadı görevi de sonradan cevaplayabilir; telefonda yalnız bekleyen görev kapanır.
    .in("status", input.via === "link" ? ["pending", "unreachable"] : ["pending"])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("anket görevi tamamlanamadı", error.message);
    throw new Error("save_failed");
  }
  if (!updated) return { done: false, referralUrl: null };

  if (input.answers.length > 0) {
    const { error: aErr } = await db
      .from("survey_answers")
      .insert(input.answers.map((a) => ({ ...a, tenant_id: task.tenant_id, task_id: task.id })));
    if (aErr) console.error("anket cevapları yazılamadı", aErr.message);
  }
  if (input.via === "phone") {
    await db.from("survey_attempts").insert({ tenant_id: task.tenant_id, task_id: task.id, user_id: input.userId, outcome: "completed" });
  }

  if (isLowScore(input.score, input.settings.low_score_max)) {
    await lowScoreFollowUp(db, task, input.score ?? 0, input.customerName);
  }
  if (task.event_type === "deal_won" && task.deal_id && task.customer_id && input.score !== null && (task.audience === "buyer" || task.audience === "tenant")) {
    await mirrorToSatisfactionSurvey(db, task, input.score, input.comment, nowIso);
  }
  let referralUrl: string | null = null;
  if (isPromoter(input.score) && input.settings.promoter_invite) {
    referralUrl = await promoterReferralInvite(db, task, input.customerName, input.score ?? 0);
  }
  return { done: true, referralUrl };
}

async function mirrorToSatisfactionSurvey(db: SupabaseClient, task: CompletableTask, score: number, comment: string | null, nowIso: string) {
  try {
    const { error } = await db.from("surveys").insert({
      tenant_id: task.tenant_id,
      deal_id: task.deal_id,
      customer_id: task.customer_id,
      agent_id: task.agent_id,
      score,
      comment,
      status: "answered",
      answered_at: nowIso,
    });
    if (error?.code === "23505") {
      // Bu anlaşma için bağlı link anketi zaten üretilmişse ve bekliyorsa cevabı oraya yaz.
      await db
        .from("surveys")
        .update({ score, comment, status: "answered", answered_at: nowIso })
        .eq("tenant_id", task.tenant_id)
        .eq("deal_id", task.deal_id)
        .eq("status", "pending");
    } else if (error) {
      console.error("NPS yansıtma", error.message);
    }
  } catch (e) {
    console.error("NPS yansıtma", e);
  }
}

/** Ofisin ilk aktif sahibi (danışmansız görevde takip görevi ona düşer). */
async function firstOwnerId(db: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

/**
 * Düşük puan zinciri 1. halka: danışmana (yoksa ofis sahibine) 24 saat vadeli "geri arama" görevi + bildirim.
 * `low_score_handled` burada YAZILMAZ: takip yalnız aksiyon notuyla kapanır (`survey_close_low_score`).
 */
async function lowScoreFollowUp(db: SupabaseClient, task: CompletableTask, score: number, customerName: string) {
  try {
    const assignee = task.agent_id ?? (await firstOwnerId(db, task.tenant_id));
    if (!assignee) return;
    const name = customerName || task.contact_name || "Müşteri";
    const { data: created, error } = await db
      .from("tasks")
      .insert({
        tenant_id: task.tenant_id,
        title: `Geri arama: ${name} (anket puanı ${score}/10)`,
        notes:
          "Anket sonucunda düşük puan alındı. Müşteriyi arayıp deneyimi telafi edin; kapanışta Anketler > Düşük puan takibi bölümüne aksiyon notu yazın. 24 saat içinde kapanmazsa takım liderine, 48 saatte ofis sahibine bildirilir.",
        kind: "call",
        priority: "high",
        due_at: new Date(Date.now() + 86_400_000).toISOString(),
        assigned_to: assignee,
        customer_id: task.customer_id,
        property_id: task.property_id,
        deal_id: task.deal_id,
      })
      .select("id")
      .maybeSingle();
    if (error) console.error("düşük puan takip görevi", error.message);
    if (created?.id) {
      const { error: linkErr } = await db
        .from("survey_tasks")
        .update({ followup_task_id: created.id })
        .eq("id", task.id)
        .eq("tenant_id", task.tenant_id);
      if (linkErr && !isMissingColumn(linkErr)) console.error("düşük puan takip bağlantısı", linkErr.message);
    }
    await notifyTenant({
      tenantId: task.tenant_id,
      userId: assignee,
      title: `Düşük anket puanı: ${name} ${score}/10 verdi`,
      body: "Geri arama görevi açıldı. 24 saat içinde arayıp aksiyon notuyla kapatın.",
      href: "/app/anketler?takip=acik",
      kind: "warning",
      prefKey: "survey",
      dedupeKey: `survey-low:${task.id}:0`,
    });
  } catch (e) {
    console.error("düşük puan takibi", e);
  }
}

/**
 * Destekleyen (9-10) müşteriye tavsiye daveti: müşteriye özel tavsiye bağlantısı (varsa mevcut aktif bağlantı) +
 * danışmana bildirim. Yalnız müşteri kaydı olan görevde ve "Akıllı listeler ve tavsiyeler" modülü açıkken.
 * Hata akışı bozmaz; döner: tavsiye sayfası adresi (teşekkür ekranında gösterilir) ya da null.
 */
async function promoterReferralInvite(db: SupabaseClient, task: CompletableTask, customerName: string, score: number): Promise<string | null> {
  if (!task.customer_id) return null;
  try {
    const modules = await loadTenantModuleState(db, task.tenant_id);
    if (!isFeatureEnabledIn(modules, "smart_lists")) return null;
    const { data: existing } = await db
      .from("referral_links")
      .select("public_token")
      .eq("tenant_id", task.tenant_id)
      .eq("customer_id", task.customer_id)
      .eq("is_active", true)
      .maybeSingle();
    let token = existing?.public_token ? String(existing.public_token) : null;
    if (!token) {
      const { data: created, error } = await db
        .from("referral_links")
        .insert({ tenant_id: task.tenant_id, customer_id: task.customer_id, staff_id: task.agent_id })
        .select("public_token")
        .maybeSingle();
      if (error) {
        console.error("tavsiye daveti", error.message);
        return null;
      }
      token = created?.public_token ? String(created.public_token) : null;
    }
    if (!token) return null;
    if (task.agent_id) {
      await notifyTenant({
        tenantId: task.tenant_id,
        userId: task.agent_id,
        title: `${customerName || "Müşteriniz"} ${score}/10 verdi: tavsiye daveti hazır`,
        body: "Destekleyen müşteriye tavsiye bağlantısı sunuldu. Tavsiyeler sayfasından takip edebilirsiniz.",
        href: "/app/tavsiyeler",
        kind: "success",
        prefKey: "survey",
        dedupeKey: `survey-promoter:${task.id}`,
      });
    }
    return `${getBaseUrl()}/tavsiye/${token}`;
  } catch (e) {
    console.error("tavsiye daveti", e);
    return null;
  }
}
