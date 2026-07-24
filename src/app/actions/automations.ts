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
};

/**
 * Hazır şablon otomasyonu kaydet.
 * Aynı trigger_type'tan aktif otomasyon varsa hata döner (duplicate önlemi).
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

  // Duplicate kontrolü — aynı trigger_type aktif mi?
  const { data: existing } = await supabase
    .from("automations")
    .select("id")
    .eq("tenant_id", gate.tenantId)
    .eq("trigger_type", template.trigger_type)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { error: `Bu tetikleyici türü için zaten aktif bir otomasyon var.` };
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
