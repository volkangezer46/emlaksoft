"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import type { PlaybookTriggerEvent } from "@/lib/playbook-engine";
import { PLAYBOOK_TRIGGER_EVENTS } from "@/lib/playbook-labels";
import { findPlaybookTemplate } from "@/lib/playbook-templates";

/**
 * İş akışı (playbook) yönetimi — /app/ayarlar/is-akislari.
 *
 * Playbook, `settings` modülünün altında yaşar (yeni modül AÇILMADI):
 * yetki kapısı her action'da `requirePermission("settings", "edit")`.
 *
 * Adımlar formdan TEK JSON alanı (`steps`) ile gelir. Sebep: adım satırları
 * client tarafında ekleniyor/siliniyor/sıralanıyor; her satır için ayrı
 * `steps[0][title]` tarzı isimlendirme hem kırılgan hem sunucuda yeniden
 * ayrıştırma gerektiriyor. JSON tek noktada doğrulanır (`parseSteps`).
 *
 * Adım yazımı DEĞİŞTİRME değil, SİL-YAZ: playbook güncellenirken mevcut
 * adımlar silinip yenileri yazılır. Adımlar kimliksiz veri (görev şablonu),
 * geçmiş `playbook_runs` üzerinden zaten `created_task_ids` ile korunuyor.
 */

export type PlaybookResult = { ok?: boolean; error?: string; id?: string };

const KINDS = ["followup", "call", "visit", "document", "other"];
const PRIORITIES = ["low", "normal", "high"];
const ASSIGN_TO = ["owner", "creator", "specific"];

const MAX_STEPS = 25;

type ParsedStep = {
  sort_order: number;
  title: string;
  kind: string;
  priority: string;
  offset_days: number;
  assign_to: string;
  assignee_id: string | null;
  note: string | null;
};

/** `steps` JSON alanını doğrular; hatalı satırda tüm kaydı reddeder. */
function parseSteps(raw: unknown): { ok: true; steps: ParsedStep[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" && raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return { ok: false, error: "Adım listesi okunamadı." };
  }
  if (!Array.isArray(parsed)) return { ok: false, error: "Adım listesi geçersiz." };
  if (parsed.length === 0) return { ok: false, error: "En az bir adım eklemelisiniz." };
  if (parsed.length > MAX_STEPS) return { ok: false, error: `En fazla ${MAX_STEPS} adım eklenebilir.` };

  const steps: ParsedStep[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const s = parsed[i] as Record<string, unknown>;
    const title = String(s?.title ?? "").trim();
    if (!title) return { ok: false, error: `${i + 1}. adımın başlığı boş olamaz.` };
    if (title.length > 200) return { ok: false, error: `${i + 1}. adımın başlığı çok uzun.` };

    const kind = String(s?.kind ?? "followup");
    if (!KINDS.includes(kind)) return { ok: false, error: `${i + 1}. adımın türü geçersiz.` };

    const priority = String(s?.priority ?? "normal");
    if (!PRIORITIES.includes(priority)) return { ok: false, error: `${i + 1}. adımın önceliği geçersiz.` };

    const assignTo = String(s?.assign_to ?? "owner");
    if (!ASSIGN_TO.includes(assignTo)) return { ok: false, error: `${i + 1}. adımın atama kuralı geçersiz.` };

    const offsetRaw = Number(s?.offset_days ?? 0);
    if (!Number.isFinite(offsetRaw) || offsetRaw < 0 || offsetRaw > 365) {
      return { ok: false, error: `${i + 1}. adımın gün değeri 0-365 arasında olmalı.` };
    }

    const assigneeId = String(s?.assignee_id ?? "").trim();
    if (assignTo === "specific" && !assigneeId) {
      return { ok: false, error: `${i + 1}. adımda kişi seçmelisiniz.` };
    }

    const note = String(s?.note ?? "").trim();

    steps.push({
      sort_order: i,
      title,
      kind,
      priority,
      offset_days: Math.floor(offsetRaw),
      assign_to: assignTo,
      assignee_id: assignTo === "specific" ? assigneeId : null,
      note: note ? note.slice(0, 500) : null,
    });
  }
  return { ok: true, steps };
}

/** Başlık/tetikleyici/filtre alanlarını ayrıştırır — create/update ortak. */
function parseHeader(fd: FormData):
  | { ok: true; name: string; description: string | null; trigger_event: PlaybookTriggerEvent; filter: Record<string, string> | null; is_active: boolean }
  | { ok: false; error: string } {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "İş akışı adı zorunludur." };
  if (name.length > 160) return { ok: false, error: "İş akışı adı en fazla 160 karakter olabilir." };

  const trigger = String(fd.get("trigger_event") ?? "").trim();
  if (!(PLAYBOOK_TRIGGER_EVENTS as string[]).includes(trigger)) {
    return { ok: false, error: "Geçersiz tetikleyici olay." };
  }

  const description = String(fd.get("description") ?? "").trim();
  const filterKey = String(fd.get("filter_key") ?? "").trim();
  const filterValue = String(fd.get("filter_value") ?? "").trim();
  // Yalnız ikisi de doluysa filtre kurulur; tek başına anahtar anlamsız.
  const filter = filterKey && filterValue ? { [filterKey]: filterValue } : null;

  return {
    ok: true,
    name,
    description: description ? description.slice(0, 600) : null,
    trigger_event: trigger as PlaybookTriggerEvent,
    filter,
    is_active: fd.get("is_active") === "on" || fd.get("is_active") === "true",
  };
}

function revalidatePlaybooks() {
  revalidatePath("/app/ayarlar/is-akislari");
  revalidatePath("/app/otomasyonlar");
}

/** Yeni iş akışı + adımları oluşturur. */
export async function createPlaybook(_prev: PlaybookResult, fd: FormData): Promise<PlaybookResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const header = parseHeader(fd);
  if (!header.ok) return { error: header.error };
  const parsedSteps = parseSteps(fd.get("steps"));
  if (!parsedSteps.ok) return { error: parsedSteps.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playbooks")
    .insert({
      tenant_id: gate.tenantId,
      name: header.name,
      description: header.description,
      trigger_event: header.trigger_event,
      filter: header.filter,
      is_active: header.is_active,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createPlaybook", error);
    return { error: "İş akışı kaydedilemedi." };
  }

  const { error: stepError } = await supabase.from("playbook_steps").insert(
    parsedSteps.steps.map((s) => ({ ...s, tenant_id: gate.tenantId, playbook_id: data.id })),
  );
  if (stepError) {
    // Adımsız playbook işe yaramaz — başlığı da geri al (yarım kayıt bırakma).
    await supabase.from("playbooks").delete().eq("id", data.id).eq("tenant_id", gate.tenantId);
    console.error("createPlaybook steps", stepError);
    return { error: "İş akışı adımları kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "playbook.create",
    entityType: "playbook",
    entityId: data.id,
    newValue: { name: header.name, trigger_event: header.trigger_event, steps: parsedSteps.steps.length },
  });

  revalidatePlaybooks();
  return { ok: true, id: data.id };
}

/** Mevcut iş akışını günceller; adımlar sil-yaz ile yenilenir. */
export async function updatePlaybook(_prev: PlaybookResult, fd: FormData): Promise<PlaybookResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "İş akışı bulunamadı." };

  const header = parseHeader(fd);
  if (!header.ok) return { error: header.error };
  const parsedSteps = parseSteps(fd.get("steps"));
  if (!parsedSteps.ok) return { error: parsedSteps.error };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("playbooks")
    .select("id, name")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!existing) return { error: "İş akışı bulunamadı." };

  const { error } = await supabase
    .from("playbooks")
    .update({
      name: header.name,
      description: header.description,
      trigger_event: header.trigger_event,
      filter: header.filter,
      is_active: header.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updatePlaybook", error);
    return { error: "İş akışı güncellenemedi." };
  }

  await supabase.from("playbook_steps").delete().eq("playbook_id", id).eq("tenant_id", gate.tenantId);
  const { error: stepError } = await supabase.from("playbook_steps").insert(
    parsedSteps.steps.map((s) => ({ ...s, tenant_id: gate.tenantId, playbook_id: id })),
  );
  if (stepError) {
    console.error("updatePlaybook steps", stepError);
    return { error: "İş akışı adımları kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "playbook.update",
    entityType: "playbook",
    entityId: id,
    oldValue: { name: existing.name },
    newValue: { name: header.name, trigger_event: header.trigger_event, steps: parsedSteps.steps.length },
  });

  revalidatePlaybooks();
  return { ok: true, id };
}

/** Aktif/pasif anahtarı — liste satırından tek tık. */
export async function togglePlaybookActive(id: string, isActive: boolean): Promise<PlaybookResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!id) return { error: "İş akışı bulunamadı." };

  const supabase = await createClient();

  // Adımsız bir akışı yayına almak sessiz bir "hiçbir şey olmadı" üretir.
  if (isActive) {
    const { count } = await supabase
      .from("playbook_steps")
      .select("id", { count: "exact", head: true })
      .eq("playbook_id", id)
      .eq("tenant_id", gate.tenantId);
    if (!count) return { error: "Adımı olmayan iş akışı yayına alınamaz." };
  }

  const { error } = await supabase
    .from("playbooks")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("togglePlaybookActive", error);
    return { error: "Durum güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: isActive ? "playbook.activate" : "playbook.deactivate",
    entityType: "playbook",
    entityId: id,
    newValue: { is_active: isActive },
  });

  revalidatePlaybooks();
  return { ok: true, id };
}

/** Hazır şablondan tek tıkla kopya üretir (PASİF açılır). */
export async function applyPlaybookTemplate(fd: FormData): Promise<PlaybookResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const key = String(fd.get("template_key") ?? "").trim();
  const template = findPlaybookTemplate(key);
  if (!template) return { error: "Şablon bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playbooks")
    .insert({
      tenant_id: gate.tenantId,
      name: template.name,
      description: template.description,
      trigger_event: template.trigger_event,
      filter: template.filter,
      is_active: false,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("applyPlaybookTemplate", error);
    return { error: "Şablon kopyalanamadı." };
  }

  const { error: stepError } = await supabase.from("playbook_steps").insert(
    template.steps.map((s, i) => ({
      tenant_id: gate.tenantId,
      playbook_id: data.id,
      sort_order: i,
      title: s.title,
      kind: s.kind,
      priority: s.priority,
      offset_days: s.offset_days,
      assign_to: s.assign_to,
      assignee_id: null,
      note: s.note ?? null,
    })),
  );
  if (stepError) {
    await supabase.from("playbooks").delete().eq("id", data.id).eq("tenant_id", gate.tenantId);
    console.error("applyPlaybookTemplate steps", stepError);
    return { error: "Şablon adımları kopyalanamadı." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "playbook.template",
    entityType: "playbook",
    entityId: data.id,
    newValue: { template: template.key, steps: template.steps.length },
  });

  revalidatePlaybooks();
  return { ok: true, id: data.id };
}

/** İş akışını siler (adımlar + çalışma kayıtları cascade). ConfirmDialog imzası. */
export async function deletePlaybookForm(fd: FormData): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("playbooks").delete().eq("id", id).eq("tenant_id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "playbook.delete",
    entityType: "playbook",
    entityId: id,
  });

  revalidatePlaybooks();
}
