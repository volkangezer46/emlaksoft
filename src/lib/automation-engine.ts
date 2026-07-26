import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { sendSms, sendWhatsApp } from "@/lib/messaging/netgsm";

/**
 * Otomasyon motoru — `automations` tablosundaki kuralları fiilen ÇALIŞTIRAN katman.
 *
 * İki giriş noktası:
 *   1. runScheduledAutomations()  — zaman tabanlı tetikleyiciler (auth_expiring,
 *      demand_stale, no_contact_days, appointment_missed). Cron'dan çağrılır,
 *      tüm tenant'ların AKTİF otomasyonlarını tarar.
 *   2. dispatchAutomationEvent()  — olay tabanlı tetikleyiciler (new_customer,
 *      new_demand, new_property, offer_received, deal_won, deal_lost,
 *      property_matched). Server action'lardan başarılı yazım SONRASI çağrılır.
 *      ASLA throw etmez — otomasyon hatası ana işlemi bozamaz.
 *
 * MÜKERRER KORUMASI (dedupe):
 *   - Zamanlanmış tetikleyicilerde aynı kayıt için aynı otomasyonun her cron'da
 *     tekrar aksiyon üretmesi `automation_logs` üzerinden engellenir: son
 *     REFIRE_WINDOW_DAYS gün içinde (automation_id, entity_id) için başarılı
 *     log varsa kayıt atlanır. Log sorgusu otomasyon başına TEK sorgudur
 *     (notify-batch'teki N+1 önleme felsefesi).
 *   - create_task aksiyonu ek emniyet olarak görev notuna deterministik
 *     `[oto:<otomasyonId8>:<kayıtId8>]` izi bırakır; aynı izli AÇIK görev
 *     varsa yeni görev açılmaz (gorev-hatirlat'taki marker deseni).
 *
 * Her koşulda: aksiyon üretilen otomasyonun run_count'u artar, last_run_at
 * güncellenir ve automation_logs'a satır yazılır.
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type AutomationEventTrigger =
  | "new_customer"
  | "new_demand"
  | "new_property"
  | "property_matched"
  | "offer_received"
  | "deal_won"
  | "deal_lost";

export type AutomationScheduledTrigger =
  | "no_contact_days"
  | "auth_expiring"
  | "appointment_missed"
  | "demand_stale";

type AutomationRow = {
  id: string;
  tenant_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: unknown;
  actions: { type?: string; config?: Record<string, unknown> }[] | null;
  run_count: number;
};

export type AutomationEventPayload = {
  entityType: "customer" | "demand" | "property" | "offer" | "deal" | "appointment";
  entityId: string;
  /** Bildirim/görev metinlerinde görünen insan-okur etiket (müşteri adı, portföy kodu vb.) */
  label?: string | null;
  customerId?: string | null;
  propertyId?: string | null;
  dealId?: string | null;
  /** Görev/bildirim atanacak kullanıcı (danışman) */
  assignedTo?: string | null;
  /** SMS/WhatsApp hedefi; yoksa customerId üzerinden bakılır */
  phone?: string | null;
  /** Koşul (conditions) değerlendirmesinde kullanılan ham alanlar */
  fields?: Record<string, unknown>;
};

export type ScheduledRunSummary = {
  automationsEvaluated: number;
  entitiesMatched: number;
  actionsExecuted: number;
  skippedDuplicates: number;
};

const SCHEDULED_TRIGGERS: AutomationScheduledTrigger[] = [
  "no_contact_days",
  "auth_expiring",
  "appointment_missed",
  "demand_stale",
];

/** Aynı kayıt için aynı otomasyonun yeniden tetiklenebilmesi için geçmesi gereken süre */
const REFIRE_WINDOW_DAYS = 30;
/** Bir otomasyonun tek cron çalışmasında işleyeceği en fazla kayıt (patlama önleme) */
const MAX_ENTITIES_PER_RUN = 25;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function cfgNumber(cfg: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const k of keys) {
    const v = Number(cfg?.[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
}

/**
 * conditions: [{field, op, value}] — kayıt alanlarına karşı değerlendirilir.
 * Bilinmeyen alan/operatör GEÇER sayılır (fail-open): şablonlar boş koşulla
 * geliyor, elle girilmiş hatalı bir koşulun tüm otomasyonu susturması istenmez.
 */
function evaluateConditions(conditions: unknown, fields: Record<string, unknown>): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((raw) => {
    if (!raw || typeof raw !== "object") return true;
    const c = raw as { field?: unknown; op?: unknown; value?: unknown };
    const field = String(c.field ?? "");
    if (!field || !(field in fields)) return true;
    const actual = fields[field];
    const expected = c.value;
    const op = String(c.op ?? "eq");
    const aNum = Number(actual);
    const eNum = Number(expected);
    switch (op) {
      case "eq":  return String(actual ?? "") === String(expected ?? "");
      case "neq": return String(actual ?? "") !== String(expected ?? "");
      case "gt":  return Number.isFinite(aNum) && Number.isFinite(eNum) && aNum > eNum;
      case "gte": return Number.isFinite(aNum) && Number.isFinite(eNum) && aNum >= eNum;
      case "lt":  return Number.isFinite(aNum) && Number.isFinite(eNum) && aNum < eNum;
      case "lte": return Number.isFinite(aNum) && Number.isFinite(eNum) && aNum <= eNum;
      case "contains":
        return String(actual ?? "").toLocaleLowerCase("tr-TR").includes(String(expected ?? "").toLocaleLowerCase("tr-TR"));
      default:
        return true;
    }
  });
}

/** `{{name}}` gibi yer tutucuları doldurur. */
function renderTemplate(text: string, payload: AutomationEventPayload): string {
  return text.replace(/\{\{\s*name\s*\}\}/gi, payload.label ?? "");
}

function hrefForEntity(payload: AutomationEventPayload): string {
  switch (payload.entityType) {
    case "customer":
      return payload.customerId ? `/app/musteriler/${payload.customerId}` : "/app/musteriler";
    case "property":
      return payload.propertyId ? `/app/portfoyler/${payload.propertyId}` : "/app/portfoyler";
    case "demand":
      return "/app/talepler";
    case "offer":
      return "/app/teklifler";
    case "deal":
      return "/app/anlasmalar";
    case "appointment":
      return "/app/randevular";
  }
}

/** SMS/WhatsApp hedef telefonu: payload'da yoksa müşteri kaydından okur. */
async function resolvePhone(
  admin: SupabaseClient,
  tenantId: string,
  payload: AutomationEventPayload,
): Promise<string | null> {
  if (payload.phone) return payload.phone;
  if (!payload.customerId) return null;
  const { data } = await admin
    .from("customers")
    .select("phone")
    .eq("id", payload.customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data?.phone as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Aksiyon uygulayıcıları
// ---------------------------------------------------------------------------

type ActionOutcome = { type: string; result: "ok" | "skip" | "error"; detail?: string };

async function executeAction(
  admin: SupabaseClient,
  automation: AutomationRow,
  action: { type?: string; config?: Record<string, unknown> },
  payload: AutomationEventPayload,
): Promise<ActionOutcome> {
  const type = String(action.type ?? "");
  const cfg = action.config ?? {};

  try {
    switch (type) {
      case "create_task": {
        // Deterministik iz — aynı otomasyon + aynı kayıt için açık görev varsa atla
        const marker = `[oto:${automation.id.slice(0, 8)}:${payload.entityId.slice(0, 8)}]`;
        const { data: existing } = await admin
          .from("tasks")
          .select("id")
          .eq("tenant_id", automation.tenant_id)
          .eq("status", "open")
          .like("notes", `%${marker}%`)
          .limit(1);
        if (existing && existing.length > 0) {
          return { type, result: "skip", detail: "open_task_exists" };
        }

        const title = String(cfg.title ?? automation.name);
        const dueMinutes = Number(cfg.due_minutes);
        const dueDays = Number(cfg.due_days);
        const dueAt = Number.isFinite(dueMinutes) && dueMinutes > 0
          ? new Date(Date.now() + dueMinutes * 60_000).toISOString()
          : Number.isFinite(dueDays) && dueDays > 0
            ? new Date(Date.now() + dueDays * DAY_MS).toISOString()
            : null;
        const priorityRaw = String(cfg.priority ?? "normal");
        const priority = ["low", "normal", "high"].includes(priorityRaw) ? priorityRaw : "normal";

        const { error } = await admin.from("tasks").insert({
          tenant_id: automation.tenant_id,
          title: payload.label ? `${title} · ${payload.label}` : title,
          notes: `Otomasyon: ${automation.name} ${marker}`,
          kind: "followup",
          priority,
          status: "open",
          due_at: dueAt,
          assigned_to: payload.assignedTo ?? null,
          customer_id: payload.customerId ?? null,
          property_id: payload.propertyId ?? null,
          deal_id: payload.dealId ?? null,
        });
        if (error) return { type, result: "error", detail: error.message };
        return { type, result: "ok" };
      }

      case "send_notification": {
        await notifyTenant({
          tenantId: automation.tenant_id,
          userId: payload.assignedTo ?? null,
          title: automation.name,
          body: [String(cfg.message ?? ""), payload.label ?? ""].filter(Boolean).join(" · ") || automation.name,
          href: hrefForEntity(payload),
          kind: "info",
        });
        return { type, result: "ok" };
      }

      case "notify_manager": {
        // user_id boş bildirim tenant genelidir (leak-sla deseni) — yöneticiler görür
        await notifyTenant({
          tenantId: automation.tenant_id,
          title: automation.name,
          body: [String(cfg.message ?? ""), payload.label ?? ""].filter(Boolean).join(" · ") || automation.name,
          href: hrefForEntity(payload),
          kind: "warning",
        });
        return { type, result: "ok" };
      }

      case "send_sms": {
        const phone = await resolvePhone(admin, automation.tenant_id, payload);
        if (!phone) return { type, result: "skip", detail: "no_phone" };
        const text = renderTemplate(String(cfg.template ?? cfg.message ?? automation.name), payload);
        const res = await sendSms(phone, text);
        // Kredi/yapılandırma yoksa sessizce atla — otomasyonu hataya düşürme
        if (!res.ok) return { type, result: "skip", detail: res.error };
        return { type, result: "ok" };
      }

      case "send_whatsapp": {
        const phone = await resolvePhone(admin, automation.tenant_id, payload);
        if (!phone) return { type, result: "skip", detail: "no_phone" };
        const text = renderTemplate(String(cfg.template ?? cfg.message ?? automation.name), payload);
        const res = await sendWhatsApp(phone, text);
        if (!res.ok) return { type, result: "skip", detail: res.error };
        return { type, result: "ok" };
      }

      case "assign_to_staff": {
        const assigneeId = String(cfg.assignee_id ?? "").trim();
        if (!assigneeId) return { type, result: "skip", detail: "no_assignee" };

        // Danışman bu tenant'ta ve aktif mi?
        const { data: prof } = await admin
          .from("profiles")
          .select("id")
          .eq("id", assigneeId)
          .eq("tenant_id", automation.tenant_id)
          .eq("is_active", true)
          .maybeSingle();
        if (!prof) return { type, result: "skip", detail: "assignee_not_found" };

        // Zincirdeki sonraki aksiyonlar (create_task, send_notification)
        // artık bu kişiyi hedeflesin.
        payload.assignedTo = assigneeId;

        // Tetikleyicinin entity'sine göre kalıcı atama:
        //  - müşteri bağlamı varsa customers.assigned_to
        //  - portföy olayıysa properties.assigned_to
        //  - ikisi de yoksa yapılacak kalıcı atama yok → skip (+log)
        if (payload.customerId) {
          const { error } = await admin
            .from("customers")
            .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
            .eq("id", payload.customerId)
            .eq("tenant_id", automation.tenant_id);
          if (error) return { type, result: "error", detail: error.message };
          return { type, result: "ok", detail: "customer_assigned" };
        }
        if (payload.entityType === "property" && payload.propertyId) {
          const { error } = await admin
            .from("properties")
            .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
            .eq("id", payload.propertyId)
            .eq("tenant_id", automation.tenant_id);
          if (error) return { type, result: "error", detail: error.message };
          return { type, result: "ok", detail: "property_assigned" };
        }
        return { type, result: "skip", detail: "no_assignable_entity" };
      }

      case "add_tag": {
        const tag = String(cfg.tag ?? "").trim();
        if (!tag) return { type, result: "skip", detail: "no_tag" };
        if (!payload.customerId) return { type, result: "skip", detail: "no_customer" };

        const { data: customer, error: readError } = await admin
          .from("customers")
          .select("id, tags")
          .eq("id", payload.customerId)
          .eq("tenant_id", automation.tenant_id)
          .maybeSingle();
        if (readError) return { type, result: "error", detail: readError.message };
        if (!customer) return { type, result: "skip", detail: "customer_not_found" };

        const tags = Array.isArray(customer.tags) ? customer.tags.map(String) : [];
        if (tags.includes(tag)) return { type, result: "skip", detail: "tag_exists" };

        const { error } = await admin
          .from("customers")
          .update({ tags: [...tags, tag], updated_at: new Date().toISOString() })
          .eq("id", payload.customerId)
          .eq("tenant_id", automation.tenant_id);
        if (error) return { type, result: "error", detail: error.message };
        return { type, result: "ok" };
      }

      case "change_status": {
        const target = String(cfg.target_status ?? "").trim();
        if (!target) return { type, result: "skip", detail: "no_target_status" };

        if (payload.entityType === "demand") {
          if (!["new", "active", "matched", "closed"].includes(target)) {
            return { type, result: "skip", detail: "invalid_demand_status" };
          }
          // customer_demands'ta updated_at kolonu yok — yalnızca status yazılır
          const { error } = await admin
            .from("customer_demands")
            .update({ status: target })
            .eq("id", payload.entityId)
            .eq("tenant_id", automation.tenant_id);
          if (error) return { type, result: "error", detail: error.message };
          return { type, result: "ok", detail: `demand→${target}` };
        }

        if (payload.entityType === "deal" || payload.dealId) {
          if (!["new", "qualified", "negotiation", "won", "lost"].includes(target)) {
            return { type, result: "skip", detail: "invalid_deal_stage" };
          }
          const dealId = payload.dealId ?? payload.entityId;
          const { error } = await admin
            .from("deals")
            .update({ stage: target, updated_at: new Date().toISOString() })
            .eq("id", dealId)
            .eq("tenant_id", automation.tenant_id);
          if (error) return { type, result: "error", detail: error.message };
          return { type, result: "ok", detail: `deal→${target}` };
        }

        return { type, result: "skip", detail: "unsupported_entity" };
      }

      default:
        return { type, result: "skip", detail: "unsupported_action" };
    }
  } catch (e) {
    return { type, result: "error", detail: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Tek otomasyonu tek kayıt için çalıştırır: koşullar + aksiyonlar + log.
 * En az bir aksiyon 'ok' dönerse true döner (run_count buna göre artar).
 */
async function runAutomationForEntity(
  admin: SupabaseClient,
  automation: AutomationRow,
  payload: AutomationEventPayload,
): Promise<{ executed: number; outcomes: ActionOutcome[] }> {
  if (!evaluateConditions(automation.conditions, payload.fields ?? {})) {
    return { executed: 0, outcomes: [] };
  }

  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  const outcomes: ActionOutcome[] = [];
  for (const action of actions) {
    outcomes.push(await executeAction(admin, automation, action, payload));
  }

  const executed = outcomes.filter((o) => o.result === "ok").length;
  const anyError = outcomes.some((o) => o.result === "error");

  // Log: en az bir aksiyon başarılıysa 'ok' (dedupe bu satıra bakar),
  // hepsi başarısızsa 'error' (bir sonraki cron'da yeniden denenebilir).
  const { error: logError } = await admin.from("automation_logs").insert({
    automation_id: automation.id,
    tenant_id: automation.tenant_id,
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    actions_taken: outcomes,
    result: executed > 0 ? "ok" : anyError ? "error" : "skip",
    error_msg: anyError
      ? outcomes.filter((o) => o.result === "error").map((o) => `${o.type}: ${o.detail ?? ""}`).join("; ")
      : null,
  });
  if (logError) console.error("automation_logs insert", logError.message);

  return { executed, outcomes };
}

/** run_count + last_run_at güncelle (firedCount kadar artar). */
async function bumpRunStats(admin: SupabaseClient, automation: AutomationRow, firedCount: number) {
  if (firedCount <= 0) return;
  const { error } = await admin
    .from("automations")
    .update({
      run_count: automation.run_count + firedCount,
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", automation.id);
  if (error) console.error("automations run_count update", error.message);
}

// ---------------------------------------------------------------------------
// 1) Olay tabanlı giriş noktası
// ---------------------------------------------------------------------------

/**
 * Olay tabanlı tetikleyici: ilgili tenant'ın aktif otomasyonlarını bulup
 * aksiyonlarını uygular. ASLA throw etmez — çağıran server action'ın
 * başarısını etkileyemez.
 */
export async function dispatchAutomationEvent(
  tenantId: string,
  trigger: AutomationEventTrigger,
  payload: AutomationEventPayload,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("automations")
      .select("id, tenant_id, name, trigger_type, trigger_config, conditions, actions, run_count")
      .eq("tenant_id", tenantId)
      .eq("trigger_type", trigger)
      .eq("status", "active")
      .limit(20);

    if (error || !data || data.length === 0) return;

    for (const row of data as AutomationRow[]) {
      const { executed } = await runAutomationForEntity(admin, row, payload);
      await bumpRunStats(admin, row, executed > 0 ? 1 : 0);
    }
  } catch (e) {
    // Sessiz log — olay kaynağındaki işlem asla bozulmamalı
    console.error("dispatchAutomationEvent", trigger, e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// 2) Zamanlanmış giriş noktası (cron)
// ---------------------------------------------------------------------------

/** Otomasyon için son REFIRE_WINDOW_DAYS içinde loglanmış kayıt id'leri (tek sorgu). */
async function fetchRecentlyFiredEntityIds(
  admin: SupabaseClient,
  automationId: string,
): Promise<Set<string>> {
  const since = new Date(Date.now() - REFIRE_WINDOW_DAYS * DAY_MS).toISOString();
  const fired = new Set<string>();
  const { data, error } = await admin
    .from("automation_logs")
    .select("entity_id, result")
    .eq("automation_id", automationId)
    .gte("created_at", since)
    .limit(2000);
  if (error) {
    console.error("fetchRecentlyFiredEntityIds", error.message);
    return fired;
  }
  for (const row of data ?? []) {
    // 'error' logları dedupe'a girmez — bir sonraki cron yeniden dener
    if (row.result !== "error" && row.entity_id) fired.add(String(row.entity_id).toLowerCase());
  }
  return fired;
}

/** Tetikleyiciye göre aday kayıtları toplar (otomasyon başına 1-2 sorgu). */
async function collectScheduledCandidates(
  admin: SupabaseClient,
  automation: AutomationRow,
): Promise<AutomationEventPayload[]> {
  const cfg = automation.trigger_config ?? {};
  const now = Date.now();

  switch (automation.trigger_type as AutomationScheduledTrigger) {
    case "auth_expiring": {
      const days = cfgNumber(cfg, ["days_before", "days"], 15);
      const today = new Date(now).toISOString().slice(0, 10);
      const until = new Date(now + days * DAY_MS).toISOString().slice(0, 10);
      const { data } = await admin
        .from("properties")
        .select("id, property_code, title, status, assigned_to, authorization_end")
        .eq("tenant_id", automation.tenant_id)
        .not("authorization_end", "is", null)
        .gte("authorization_end", today)
        .lte("authorization_end", until)
        .limit(200);
      return (data ?? []).map((p) => ({
        entityType: "property" as const,
        entityId: String(p.id),
        propertyId: String(p.id),
        label: [p.property_code, p.title].filter(Boolean).join(" · ") || null,
        assignedTo: (p.assigned_to as string | null) ?? null,
        fields: { status: p.status, authorization_end: p.authorization_end },
      }));
    }

    case "demand_stale": {
      const days = cfgNumber(cfg, ["days"], 30);
      const cutoff = new Date(now - days * DAY_MS).toISOString();
      const { data } = await admin
        .from("customer_demands")
        .select("id, customer_id, status, transaction_type, created_at, customer:customers(full_name, phone, assigned_to)")
        .eq("tenant_id", automation.tenant_id)
        .in("status", ["new", "active"])
        .lt("created_at", cutoff)
        .limit(200);
      return (data ?? []).map((d) => {
        const cRaw = d.customer as unknown;
        const c = (Array.isArray(cRaw) ? cRaw[0] : cRaw) as
          | { full_name?: string; phone?: string | null; assigned_to?: string | null }
          | null;
        return {
          entityType: "demand" as const,
          entityId: String(d.id),
          customerId: (d.customer_id as string | null) ?? null,
          label: c?.full_name ?? null,
          phone: c?.phone ?? null,
          assignedTo: c?.assigned_to ?? null,
          fields: { status: d.status, transaction_type: d.transaction_type },
        };
      });
    }

    case "no_contact_days": {
      const days = cfgNumber(cfg, ["days"], 14);
      const cutoff = new Date(now - days * DAY_MS).toISOString();
      // 2 sorgu: pencere içinde iletişim kurulan müşteriler + eski müşteriler; anti-join bellekte
      const { data: comms } = await admin
        .from("communications")
        .select("customer_id")
        .eq("tenant_id", automation.tenant_id)
        .gte("created_at", cutoff)
        .limit(5000);
      const contacted = new Set(
        (comms ?? []).map((r) => String(r.customer_id ?? "").toLowerCase()).filter(Boolean),
      );
      const { data: customers } = await admin
        .from("customers")
        .select("id, full_name, phone, assigned_to")
        .eq("tenant_id", automation.tenant_id)
        .is("deleted_at", null)
        .eq("blacklist", false)
        .lt("created_at", cutoff)
        .limit(500);
      return (customers ?? [])
        .filter((c) => !contacted.has(String(c.id).toLowerCase()))
        .map((c) => ({
          entityType: "customer" as const,
          entityId: String(c.id),
          customerId: String(c.id),
          label: (c.full_name as string | null) ?? null,
          phone: (c.phone as string | null) ?? null,
          assignedTo: (c.assigned_to as string | null) ?? null,
          fields: { full_name: c.full_name },
        }));
    }

    case "appointment_missed": {
      // 2 saat tolerans; en fazla 7 gün geriye bak
      const graceEnd = new Date(now - 2 * 3_600_000).toISOString();
      const lookback = new Date(now - 7 * DAY_MS).toISOString();
      const { data } = await admin
        .from("appointments")
        .select("id, customer_id, property_id, assigned_to, scheduled_at, status, customer:customers(full_name, phone)")
        .eq("tenant_id", automation.tenant_id)
        .in("status", ["pending", "confirmed"])
        .lt("scheduled_at", graceEnd)
        .gte("scheduled_at", lookback)
        .limit(200);
      return (data ?? []).map((a) => {
        const cRaw = a.customer as unknown;
        const c = (Array.isArray(cRaw) ? cRaw[0] : cRaw) as
          | { full_name?: string; phone?: string | null }
          | null;
        return {
          entityType: "appointment" as const,
          entityId: String(a.id),
          customerId: (a.customer_id as string | null) ?? null,
          propertyId: (a.property_id as string | null) ?? null,
          label: c?.full_name ?? null,
          phone: c?.phone ?? null,
          assignedTo: (a.assigned_to as string | null) ?? null,
          fields: { status: a.status, scheduled_at: a.scheduled_at },
        };
      });
    }

    default:
      return [];
  }
}

/**
 * Cron giriş noktası: tüm tenant'ların aktif, zaman tabanlı otomasyonlarını
 * tarar, koşulları değerlendirir, aksiyonları uygular.
 */
export async function runScheduledAutomations(): Promise<ScheduledRunSummary> {
  const admin = createAdminClient();
  const summary: ScheduledRunSummary = {
    automationsEvaluated: 0,
    entitiesMatched: 0,
    actionsExecuted: 0,
    skippedDuplicates: 0,
  };

  const { data: automations, error } = await admin
    .from("automations")
    .select("id, tenant_id, name, trigger_type, trigger_config, conditions, actions, run_count")
    .eq("status", "active")
    .in("trigger_type", SCHEDULED_TRIGGERS)
    .limit(500);

  if (error) {
    console.error("runScheduledAutomations", error.message);
    return summary;
  }

  for (const row of (automations ?? []) as AutomationRow[]) {
    summary.automationsEvaluated += 1;
    try {
      const [candidates, alreadyFired] = await Promise.all([
        collectScheduledCandidates(admin, row),
        fetchRecentlyFiredEntityIds(admin, row.id),
      ]);

      let fired = 0;
      for (const payload of candidates) {
        if (fired >= MAX_ENTITIES_PER_RUN) break;
        if (alreadyFired.has(payload.entityId.toLowerCase())) {
          summary.skippedDuplicates += 1;
          continue;
        }
        const { executed } = await runAutomationForEntity(admin, row, payload);
        if (executed > 0) {
          fired += 1;
          summary.entitiesMatched += 1;
          summary.actionsExecuted += executed;
        }
      }
      await bumpRunStats(admin, row, fired);
    } catch (e) {
      console.error("runScheduledAutomations", row.id, e instanceof Error ? e.message : e);
    }
  }

  return summary;
}
