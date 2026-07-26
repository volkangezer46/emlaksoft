"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";

export type AutomationResult = { ok?: boolean; error?: string; id?: string };

const TEMPLATES: Record<string, {
  name: string;
  description: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  actions: { type: string; config: Record<string, unknown> }[];
}> = {
  no_contact_days: {
    name: "14 gün dokunulmamış müşteri uyarısı",
    description: "14 gün iletişim kurulmayan müşteriler için müdüre bildirim gönderir.",
    trigger_type: "no_contact_days",
    trigger_config: { days: 14 },
    actions: [{ type: "notify_manager", config: { message: "14 gündür iletişim kurulmadı." } }],
  },
  auth_expiring: {
    name: "Yetki belgesi bitişi — görev oluştur",
    description: "Yetki belgesi 15 gün içinde dolacak portföyler için otomatik görev açar.",
    trigger_type: "auth_expiring",
    trigger_config: { days_before: 15 },
    actions: [{ type: "create_task", config: { title: "Yetki belgesi yenileme", priority: "high" } }],
  },
  new_customer: {
    name: "Yeni müşteriyle 5 dk içinde iletişim",
    description: "Yeni müşteri eklendiğinde sorumlu danışmana görev oluşturur.",
    trigger_type: "new_customer",
    trigger_config: {},
    actions: [{ type: "create_task", config: { title: "Yeni müşteri ilk arama", due_minutes: 5 } }],
  },
  deal_won: {
    name: "Satış sonrası teşekkür WhatsApp'ı",
    description: "Satış kapandığında müşteriye otomatik teşekkür mesajı gönderir.",
    trigger_type: "deal_won",
    trigger_config: {},
    actions: [{ type: "send_whatsapp", config: { template: "Sayın {{name}}, satın alımınız için teşekkür ederiz!" } }],
  },
  property_matched: {
    name: "Eşleşen portföyü müşteriye gönder",
    description: "Müşteri talebine portföy eşleşince SMS ile bildirir.",
    trigger_type: "property_matched",
    trigger_config: { min_score: 60 },
    actions: [{ type: "send_sms", config: { template: "Talebinize uygun yeni bir portföy bulundu." } }],
  },
  demand_stale: {
    name: "30 gün hareketsiz talep uyarısı",
    description: "30 gün güncelleme olmayan talepler için müdüre bildirim gönderir.",
    trigger_type: "demand_stale",
    trigger_config: { days: 30 },
    actions: [{ type: "notify_manager", config: { message: "Talep 30 gündür güncellenmedi." } }],
  },
  // Aşağıdaki şablonlar da yalnızca automation_trigger / automation_action
  // enum'larında bugün var olan tipleri kullanır (migration 20260723000036).
  offer_received: {
    name: "Teklif girildiğinde yöneticiye bildirim",
    description: "Yeni bir teklif alındığında değerlendirme için yöneticiye anında bildirim gönderir.",
    trigger_type: "offer_received",
    trigger_config: {},
    actions: [{ type: "notify_manager", config: { message: "Yeni bir teklif girildi, değerlendirmeniz bekleniyor." } }],
  },
  new_demand: {
    name: "Yeni talep için eşleştirme görevi",
    description: "Yeni talep kaydedildiğinde uygun portföyleri tarayıp önermek için görev açar.",
    trigger_type: "new_demand",
    trigger_config: {},
    actions: [{ type: "create_task", config: { title: "Talep için portföy eşleştirme", priority: "high" } }],
  },
  new_property: {
    name: "Yeni portföyü ekibe duyur",
    description: "Yeni portföy eklendiğinde ekibe uygulama içi bildirim gönderir.",
    trigger_type: "new_property",
    trigger_config: {},
    actions: [{ type: "send_notification", config: { message: "Portföye yeni bir ilan eklendi." } }],
  },
  appointment_missed: {
    name: "Kaçırılan randevu telafi görevi",
    description: "Randevu kaçırıldığında müşteriyi yeniden aramak için sorumlu danışmana görev açar.",
    trigger_type: "appointment_missed",
    trigger_config: {},
    actions: [{ type: "create_task", config: { title: "Kaçırılan randevu: müşteriyi yeniden ara", priority: "high" } }],
  },
  deal_lost: {
    name: "Kaybedilen satış geri kazanım görevi",
    description: "Satış kaybedildiğinde kayıp nedenini analiz edip müşteriyi geri kazanmak için görev açar.",
    trigger_type: "deal_lost",
    trigger_config: {},
    actions: [{ type: "create_task", config: { title: "Kayıp satış analizi ve geri kazanım", priority: "normal" } }],
  },
};

/**
 * Hazır şablon otomasyonu kaydet.
 *
 * Dedupe artık KURAL bazlıdır (tetikleyici bazlı değil): aynı tetikleyiciden
 * birden çok kural desteklenir — engine'deki mükerrer koruması zaten
 * (automation_id, entity_id) üzerinden çalışır. Burada yalnızca AYNI şablonun
 * (aynı isimli aktif kural) ikinci kez uygulanması engellenir.
 */
export async function applyAutomationTemplate(
  formData: FormData,
): Promise<AutomationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const templateKey = String(formData.get("template_key") ?? "").trim();
  const template = TEMPLATES[templateKey];
  if (!template) return { error: "Şablon bulunamadı." };

  const supabase = await createClient();

  // Kural bazlı duplicate kontrolü — aynı şablon zaten aktif mi?
  const { data: existing } = await supabase
    .from("automations")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("trigger_type", template.trigger_type)
    .eq("name", template.name)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { error: "Bu şablon zaten uygulanmış ve aktif." };
  }

  const { data, error } = await supabase
    .from("automations")
    .insert({
      tenant_id: gate.tenantId,
      name: template.name,
      description: template.description,
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config,
      actions: template.actions,
      status: "active",
      run_count: 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("applyAutomationTemplate", error);
    return { error: "Otomasyon kaydedilemedi." };
  }

  revalidatePath("/app/otomasyonlar");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Sıfırdan kural sihirbazı — createAutomation / updateAutomation
// ---------------------------------------------------------------------------

/** automation_trigger enum'unun bugünkü değerleri (migration 20260723000036). */
const TRIGGER_TYPES = [
  "new_customer", "new_demand", "new_property", "property_matched",
  "no_contact_days", "offer_received", "deal_won", "deal_lost",
  "auth_expiring", "appointment_missed", "demand_stale",
] as const;

/** automation_action enum'unun bugünkü değerleri. */
const ACTION_TYPES = [
  "send_whatsapp", "send_sms", "create_task", "assign_to_staff",
  "notify_manager", "add_tag", "change_status", "send_notification",
] as const;

const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
const DEMAND_STATUSES = ["new", "active", "matched", "closed"] as const;
const DEAL_STAGES = ["new", "qualified", "negotiation", "won", "lost"] as const;

/** Zaman tabanlı tetikleyicilerin trigger_config gün anahtarı. */
const TRIGGER_DAY_KEYS: Record<string, string> = {
  no_contact_days: "days",
  demand_stale: "days",
  auth_expiring: "days_before",
};

/** change_status aksiyonunun hedef entity'si — tetikleyiciye göre. */
const STATUS_ENTITY_BY_TRIGGER: Record<string, "demand" | "deal"> = {
  new_demand: "demand",
  demand_stale: "demand",
  deal_won: "deal",
  deal_lost: "deal",
};

type ParsedWizard = {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: { field: string; op: string; value: string }[];
  actions: { type: string; config: Record<string, unknown> }[];
};

function truncated(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

/**
 * Sihirbaz formunu doğrula/temizle. conditions ve actions JSON string gelir;
 * yalnızca beyaz-listedeki alanlar action_config / trigger_config'e yazılır.
 */
async function parseWizardForm(
  formData: FormData,
  tenantId: string,
): Promise<{ error: string } | { parsed: ParsedWizard }> {
  const name = truncated(formData.get("name"), 120);
  if (!name) return { error: "Kural adı zorunlu." };
  const description = truncated(formData.get("description"), 300) || null;

  const triggerType = String(formData.get("trigger_type") ?? "").trim();
  if (!(TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
    return { error: "Geçersiz tetikleyici." };
  }

  // trigger_config — yalnızca zaman tabanlılarda gün, property_matched'ta puan
  const triggerConfig: Record<string, unknown> = {};
  const dayKey = TRIGGER_DAY_KEYS[triggerType];
  if (dayKey) {
    const days = Number(formData.get("trigger_days"));
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return { error: "Gün sayısı 1-365 arasında olmalı." };
    }
    triggerConfig[dayKey] = Math.round(days);
  }
  if (triggerType === "property_matched") {
    const minScore = Number(formData.get("min_score"));
    if (Number.isFinite(minScore) && minScore >= 0 && minScore <= 100) {
      triggerConfig.min_score = Math.round(minScore);
    }
  }

  // conditions — en fazla 3 × {field, op, value}
  let conditions: { field: string; op: string; value: string }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("conditions") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error("bad");
    conditions = raw
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        field: truncated(c.field, 60),
        op: String(c.op ?? "eq"),
        value: truncated(c.value, 120),
      }))
      .filter((c) => c.field && (CONDITION_OPS as readonly string[]).includes(c.op));
  } catch {
    return { error: "Koşullar okunamadı." };
  }
  if (conditions.length > 3) return { error: "En fazla 3 koşul eklenebilir." };

  // actions — tek aksiyon; config beyaz liste
  let rawActions: { type?: unknown; config?: Record<string, unknown> }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("actions") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error("bad");
    rawActions = raw.filter((a): a is Record<string, unknown> => !!a && typeof a === "object");
  } catch {
    return { error: "Aksiyon okunamadı." };
  }
  if (rawActions.length === 0) return { error: "En az bir aksiyon seçin." };

  const actions: ParsedWizard["actions"] = [];
  for (const a of rawActions.slice(0, 3)) {
    const type = String(a.type ?? "");
    if (!(ACTION_TYPES as readonly string[]).includes(type)) {
      return { error: "Geçersiz aksiyon türü." };
    }
    const src = (a.config ?? {}) as Record<string, unknown>;
    const config: Record<string, unknown> = {};

    switch (type) {
      case "create_task": {
        const title = truncated(src.title, 200);
        if (!title) return { error: "Görev başlığı zorunlu." };
        config.title = title;
        const priority = String(src.priority ?? "normal");
        config.priority = ["low", "normal", "high"].includes(priority) ? priority : "normal";
        const dueDays = Number(src.due_days);
        if (Number.isFinite(dueDays) && dueDays >= 1 && dueDays <= 365) {
          config.due_days = Math.round(dueDays);
        }
        break;
      }
      case "send_sms":
      case "send_whatsapp": {
        const template = truncated(src.template, 500);
        if (!template) return { error: "Mesaj metni zorunlu." };
        config.template = template;
        break;
      }
      case "notify_manager":
      case "send_notification": {
        const message = truncated(src.message, 500);
        if (!message) return { error: "Bildirim metni zorunlu." };
        config.message = message;
        break;
      }
      case "assign_to_staff": {
        const assigneeId = truncated(src.assignee_id, 40);
        if (!assigneeId) return { error: "Atanacak danışman seçin." };
        // Danışman bu tenant'ta ve aktif mi? (RLS zaten tenant'a kısıtlar)
        const supabase = await createClient();
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", assigneeId)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .maybeSingle();
        if (!prof) return { error: "Seçilen danışman bulunamadı." };
        config.assignee_id = assigneeId;
        break;
      }
      case "add_tag": {
        const tag = truncated(src.tag, 50);
        if (!tag) return { error: "Etiket metni zorunlu." };
        config.tag = tag;
        break;
      }
      case "change_status": {
        const entity = STATUS_ENTITY_BY_TRIGGER[triggerType];
        if (!entity) return { error: "Bu tetikleyicide durum değiştirilemez." };
        const target = String(src.target_status ?? "");
        const valid = entity === "demand"
          ? (DEMAND_STATUSES as readonly string[])
          : (DEAL_STAGES as readonly string[]);
        if (!valid.includes(target)) return { error: "Geçersiz hedef durum." };
        config.target_status = target;
        break;
      }
    }
    actions.push({ type, config });
  }

  return {
    parsed: { name, description, trigger_type: triggerType, trigger_config: triggerConfig, conditions, actions },
  };
}

/**
 * Sihirbazdan serbest kural oluştur. Şablon action'ının serbest hali —
 * tetikleyici başına tek aktif kural kısıtı YOK (engine dedupe'u
 * (automation_id, entity_id) bazlı olduğundan çoklu kural güvenlidir).
 */
export async function createAutomation(formData: FormData): Promise<AutomationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const res = await parseWizardForm(formData, gate.tenantId);
  if ("error" in res) return { error: res.error };
  const { parsed } = res;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automations")
    .insert({
      tenant_id: gate.tenantId,
      name: parsed.name,
      description: parsed.description,
      trigger_type: parsed.trigger_type,
      trigger_config: parsed.trigger_config,
      conditions: parsed.conditions,
      actions: parsed.actions,
      status: "active",
      run_count: 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createAutomation", error);
    return { error: "Otomasyon kaydedilemedi." };
  }

  revalidatePath("/app/otomasyonlar");
  return { ok: true, id: data.id };
}

/**
 * Mevcut kuralı sihirbazla güncelle (ad, tetikleyici, koşullar, aksiyon).
 */
export async function updateAutomation(formData: FormData): Promise<AutomationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Kural bulunamadı." };

  const res = await parseWizardForm(formData, gate.tenantId);
  if ("error" in res) return { error: res.error };
  const { parsed } = res;

  const supabase = await createClient();
  const { error } = await supabase
    .from("automations")
    .update({
      name: parsed.name,
      description: parsed.description,
      trigger_type: parsed.trigger_type,
      trigger_config: parsed.trigger_config,
      conditions: parsed.conditions,
      actions: parsed.actions,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateAutomation", error);
    return { error: "Otomasyon güncellenemedi." };
  }

  revalidatePath("/app/otomasyonlar");
  revalidatePath(`/app/otomasyonlar/${id}`);
  return { ok: true, id };
}

/**
 * Otomasyonu aktif/pasif yap.
 */
export async function toggleAutomation(
  id: string,
  active: boolean,
): Promise<AutomationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("automations")
    .update({ status: active ? "active" : "inactive" })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Durum güncellenemedi." };

  revalidatePath("/app/otomasyonlar");
  return { ok: true };
}

/**
 * Otomasyonu sil.
 */
export async function deleteAutomation(id: string): Promise<AutomationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("automations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) return { error: "Silinemedi." };

  revalidatePath("/app/otomasyonlar");
  return { ok: true };
}
