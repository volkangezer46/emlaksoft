"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_BODY_MAX,
  TEMPLATE_TITLE_MAX,
  isTemplateCategory,
  type TemplateCategory,
} from "@/lib/message-templates";

export type TemplateResult = { ok?: boolean; error?: string };

/** WhatsApp menüsünün ve yönetim ekranının paylaştığı satır tipi. */
export type MessageTemplateRow = {
  id: string;
  title: string;
  body: string;
  category: TemplateCategory;
  is_active: boolean;
  sort_order: number;
  usage_count: number;
};

function revalidateTemplates() {
  revalidatePath("/app/ayarlar/mesaj-sablonlari");
  revalidatePath("/app/ayarlar");
}

/** Form alanlarını ayrıştırıp doğrular — create/update ortak. */
function parseForm(fd: FormData):
  | { ok: true; title: string; body: string; category: TemplateCategory; sort_order: number }
  | { ok: false; error: string } {
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  const category = String(fd.get("category") ?? "genel");
  const sortRaw = String(fd.get("sort_order") ?? "").trim();

  if (!title) return { ok: false, error: "Şablon başlığı zorunludur." };
  if (title.length > TEMPLATE_TITLE_MAX) {
    return { ok: false, error: `Başlık en fazla ${TEMPLATE_TITLE_MAX} karakter olabilir.` };
  }
  if (!body) return { ok: false, error: "Mesaj metni zorunludur." };
  if (body.length > TEMPLATE_BODY_MAX) {
    return { ok: false, error: `Mesaj metni en fazla ${TEMPLATE_BODY_MAX} karakter olabilir.` };
  }
  if (!isTemplateCategory(category)) return { ok: false, error: "Geçersiz kategori." };

  const parsedSort = Number.parseInt(sortRaw, 10);
  const sort_order = Number.isFinite(parsedSort) ? Math.max(0, Math.min(9999, parsedSort)) : 0;

  return { ok: true, title, body, category, sort_order };
}

/** Yeni şablon oluşturur. */
export async function createMessageTemplate(_prev: TemplateResult, fd: FormData): Promise<TemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const parsed = parseForm(fd);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .insert({
      tenant_id: gate.tenantId,
      title: parsed.title,
      body: parsed.body,
      category: parsed.category,
      sort_order: parsed.sort_order,
      created_by: gate.userId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("createMessageTemplate", error);
    return { error: "Şablon kaydedilemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "message_template.create",
    entityType: "message_template",
    entityId: data?.id ?? null,
    newValue: { title: parsed.title, category: parsed.category },
  });

  revalidateTemplates();
  return { ok: true };
}

/** Mevcut şablonu günceller. */
export async function updateMessageTemplate(_prev: TemplateResult, fd: FormData): Promise<TemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Şablon bulunamadı." };

  const parsed = parseForm(fd);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("message_templates")
    .update({
      title: parsed.title,
      body: parsed.body,
      category: parsed.category,
      sort_order: parsed.sort_order,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateMessageTemplate", error);
    return { error: "Şablon güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "message_template.update",
    entityType: "message_template",
    entityId: id,
    newValue: { title: parsed.title, category: parsed.category },
  });

  revalidateTemplates();
  return { ok: true };
}

/** Şablonu kalıcı siler. ConfirmDialog formAction imzası (void döner). */
export async function deleteMessageTemplateForm(fd: FormData): Promise<void> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return;

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("message_templates").delete().eq("id", id).eq("tenant_id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "message_template.delete",
    entityType: "message_template",
    entityId: id,
  });

  revalidateTemplates();
}

/** Aktif/pasif değiştirir — pasif şablon WhatsApp menüsünde görünmez. */
export async function toggleMessageTemplate(id: string, isActive: boolean): Promise<TemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!id) return { error: "Şablon bulunamadı." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("message_templates")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("toggleMessageTemplate", error);
    return { error: "Durum değiştirilemedi." };
  }

  revalidateTemplates();
  return { ok: true };
}

/**
 * Hazır şablon setini ekler. Aynı başlıklı kayıt varsa atlanır — buton
 * yanlışlıkla iki kez tıklanırsa kütüphane çiftlenmesin.
 */
export async function seedDefaultTemplates(): Promise<TemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("message_templates")
    .select("title")
    .eq("tenant_id", gate.tenantId);

  const taken = new Set((existing ?? []).map((r) => String(r.title).toLocaleLowerCase("tr")));
  const rows = DEFAULT_TEMPLATES.filter((t) => !taken.has(t.title.toLocaleLowerCase("tr"))).map((t) => ({
    tenant_id: gate.tenantId,
    title: t.title,
    body: t.body,
    category: t.category,
    sort_order: t.sort_order,
    created_by: gate.userId,
  }));

  if (rows.length === 0) return { ok: true };

  const { error } = await supabase.from("message_templates").insert(rows);
  if (error) {
    console.error("seedDefaultTemplates", error);
    return { error: "Varsayılan şablonlar eklenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "message_template.seed_defaults",
    entityType: "message_template",
    newValue: { count: rows.length },
  });

  revalidateTemplates();
  return { ok: true };
}

/**
 * WhatsApp menüsünün açılışta bir kez çektiği aktif şablon listesi.
 * Yönetim değil kullanım noktası olduğu için `customers:view` yetiyor.
 */
export async function listMessageTemplates(): Promise<{ templates: MessageTemplateRow[]; error?: string }> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return { templates: [], error: gate.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, title, body, category, is_active, sort_order, usage_count")
    .eq("tenant_id", gate.tenantId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("usage_count", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listMessageTemplates", error);
    return { templates: [], error: "Şablonlar yüklenemedi." };
  }

  return { templates: (data ?? []) as MessageTemplateRow[] };
}

/**
 * Kullanım sayacı +1 (atomik RPC). Fire-and-forget çağrılır; hata kullanıcıya
 * yansımaz — mesaj gönderimi sayaçtan daha önemli.
 */
export async function recordTemplateUsage(id: string): Promise<void> {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok || !id) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("increment_template_usage", { p_template_id: id });
  if (error) console.error("recordTemplateUsage", error);
}
