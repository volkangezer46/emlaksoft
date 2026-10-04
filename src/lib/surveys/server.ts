import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyTenant } from "@/lib/notify";
import { dueAtFor, isLowScore, resolveAssignee, type StoredQuestion, type ValidAnswer } from "@/lib/surveys/logic";
import { DEFAULT_TEMPLATES } from "@/lib/surveys/defaults";
import {
  DEFAULT_DELAY_DAYS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_SURVEY_SETTINGS,
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
 */

export function isSurveySchemaMissing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205" || code === "PGRST200") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("survey_") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
}

/** Anket tabloları veritabanında var mı? Yoksa modül "etkin değil" uyarısıyla gizlenir. */
export async function isSurveyModuleReady(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("survey_tasks").select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (isSurveySchemaMissing(error)) return false;
  console.error("survey_tasks hazırlık denetimi", error.message);
  return false;
}

export async function loadSurveySettings(db: SupabaseClient, tenantId: string): Promise<SurveySettings> {
  const { data } = await db
    .from("survey_settings")
    .select("assignment_mode, fixed_assignee, overdue_hours, retry_hours, low_score_max")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SURVEY_SETTINGS };
  const mode = data.assignment_mode === "selected" || data.assignment_mode === "manual" ? data.assignment_mode : "balanced";
  return {
    assignment_mode: mode,
    fixed_assignee: (data.fixed_assignee as string | null) ?? null,
    overdue_hours: Number(data.overdue_hours) || DEFAULT_SURVEY_SETTINGS.overdue_hours,
    retry_hours: Number(data.retry_hours) || DEFAULT_SURVEY_SETTINGS.retry_hours,
    low_score_max: Number(data.low_score_max) || DEFAULT_SURVEY_SETTINGS.low_score_max,
  };
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
  const { data } = await db
    .from("survey_tasks")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .not("assigned_to", "is", null)
    .limit(5000);
  const load = new Map<string, number>();
  for (const r of data ?? []) {
    const id = String(r.assigned_to);
    load.set(id, (load.get(id) ?? 0) + 1);
  }
  return load;
}

/**
 * Eksik varsayılan şablon ve tetikleyici satırlarını oluşturur (idempotent; mevcut satıra dokunmaz).
 * Tetikleyiciler KAPALI doğar: ofis sahibi tek tek açar.
 */
export async function ensureSurveyDefaults(db: SupabaseClient, tenantId: string): Promise<void> {
  await db.from("survey_triggers").upsert(
    SURVEY_EVENT_TYPES.map((event_type) => ({
      tenant_id: tenantId,
      event_type,
      enabled: false,
      delay_days: DEFAULT_DELAY_DAYS,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
    })),
    { onConflict: "tenant_id,event_type", ignoreDuplicates: true },
  );

  const { data: inserted, error } = await db
    .from("survey_templates")
    .upsert(
      DEFAULT_TEMPLATES.map((t) => ({ tenant_id: tenantId, event_type: t.event, audience: t.audience, name: t.name })),
      { onConflict: "tenant_id,event_type,audience", ignoreDuplicates: true },
    )
    .select("id, event_type, audience");
  if (error) {
    console.error("ensureSurveyDefaults şablon", error.message);
    return;
  }
  // Yalnız bu çağrıda YENİ doğan şablonların soruları eklenir (mevcut şablon düzenlemesi korunur).
  const rows = (inserted ?? []).flatMap((tpl) => {
    const def = DEFAULT_TEMPLATES.find((d) => d.event === tpl.event_type && d.audience === tpl.audience);
    if (!def) return [];
    return def.questions.map((q, position) => ({
      tenant_id: tenantId,
      template_id: tpl.id,
      position,
      kind: q.kind,
      label: q.label,
      options: q.options,
      required: q.required,
      tag: q.tag,
    }));
  });
  if (rows.length > 0) {
    const { error: qErr } = await db.from("survey_questions").insert(rows);
    if (qErr) console.error("ensureSurveyDefaults sorular", qErr.message);
  }
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
 * Döner: gerçekten yazılan görev sayısı.
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
    if (!templateId) continue; // şablon yok veya pasif: anket üretilmez
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

/**
 * Cevapları yazıp görevi tamamlar. Yalnız hâlâ 'pending' görev güncellenir (çift cevap yok).
 * Döner: false = görev zaten kapanmış. Düşük puanda ofis sahibine/danışmana bildirim ve "geri arama" görevi açılır;
 * kapanış (deal_won) müşteri anketinde NPS raporu için mevcut `surveys` tablosuna da yansıtılır.
 */
export async function completeSurveyTask(
  db: SupabaseClient,
  task: CompletableTask,
  input: { answers: ValidAnswer[]; score: number | null; comment: string | null; via: "phone" | "link"; userId: string | null; lowScoreMax: number; customerName: string },
): Promise<boolean> {
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
  if (!updated) return false;

  if (input.answers.length > 0) {
    const { error: aErr } = await db
      .from("survey_answers")
      .insert(input.answers.map((a) => ({ ...a, tenant_id: task.tenant_id, task_id: task.id })));
    if (aErr) console.error("anket cevapları yazılamadı", aErr.message);
  }
  if (input.via === "phone") {
    await db.from("survey_attempts").insert({ tenant_id: task.tenant_id, task_id: task.id, user_id: input.userId, outcome: "completed" });
  }

  if (isLowScore(input.score, input.lowScoreMax)) {
    await lowScoreFollowUp(db, task, input.score ?? 0, input.customerName);
  }
  if (task.event_type === "deal_won" && task.deal_id && task.customer_id && input.score !== null && (task.audience === "buyer" || task.audience === "tenant")) {
    await mirrorToSatisfactionSurvey(db, task, input.score, input.comment, nowIso);
  }
  return true;
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

async function lowScoreFollowUp(db: SupabaseClient, task: CompletableTask, score: number, customerName: string) {
  try {
    const { data: owner } = await db
      .from("profiles")
      .select("id")
      .eq("tenant_id", task.tenant_id)
      .eq("role", "owner")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const ownerId = owner?.id ? String(owner.id) : null;
    const targets = new Set<string>();
    if (task.agent_id) targets.add(task.agent_id);
    if (ownerId) targets.add(ownerId);
    const name = customerName || task.contact_name || "Müşteri";
    await Promise.all(
      [...targets].map((userId) =>
        notifyTenant({
          tenantId: task.tenant_id,
          userId,
          title: `Düşük anket puanı: ${name} ${score}/10 verdi`,
          body: "Geri arama önerisi: deneyimi telafi etmek için müşteriyi arayın.",
          href: "/app/anketler?puan=dusuk",
          kind: "warning",
        }),
      ),
    );
    const assignee = task.agent_id ?? ownerId;
    if (assignee) {
      await db.from("tasks").insert({
        tenant_id: task.tenant_id,
        title: `Geri arama önerisi: ${name} (anket puanı ${score}/10)`,
        notes: "Anket sonucunda düşük puan alındı. Müşteriyi arayıp deneyimi telafi edin.",
        kind: "call",
        priority: "high",
        due_at: new Date(Date.now() + 86_400_000).toISOString(),
        assigned_to: assignee,
        customer_id: task.customer_id,
        property_id: task.property_id,
        deal_id: task.deal_id,
      });
    }
    await db.from("survey_tasks").update({ low_score_handled: true }).eq("id", task.id).eq("tenant_id", task.tenant_id);
  } catch (e) {
    console.error("düşük puan takibi", e);
  }
}
