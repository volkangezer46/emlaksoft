"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { actionErrorMessage } from "@/lib/action-errors";

export type ContractTemplateResult = { ok?: boolean; error?: string; id?: string };

const CONTRACT_TEMPLATE_TYPES = ["satis", "kira", "sozlesme", "teklif", "yer_gosterme", "kapora", "diger"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function revalidateTemplates() {
  revalidatePath("/app/ayarlar/sozlesme-sablonlari");
  revalidatePath("/app/sozlesmeler");
}

/** Yeni ofis şablonu oluşturur (ayarlar ekranından). */
export async function createContractTemplate(
  _prev: ContractTemplateResult,
  fd: FormData,
): Promise<ContractTemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const title = String(fd.get("title") ?? "").trim();
  const type = String(fd.get("type") ?? "").trim();
  const content = String(fd.get("content") ?? "").trim();
  if (!title) return { error: "Şablon adı zorunludur." };
  if (title.length > 160) return { error: "Şablon adı en fazla 160 karakter olabilir." };
  if (!content) return { error: "Şablon içeriği boş olamaz." };
  if (content.length > 100_000) return { error: "Şablon içeriği çok uzun." };
  if (!(CONTRACT_TEMPLATE_TYPES as readonly string[]).includes(type)) return { error: "Geçersiz sözleşme türü." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .insert({ tenant_id: gate.tenantId, type, title, content, created_by: gate.userId })
    .select("id")
    .single();
  if (error || !data) {
    if (error) console.error("createContractTemplate", error);
    return { error: actionErrorMessage(error, "Şablon kaydedilemedi.") };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract_template.create",
    entityType: "contract_template",
    entityId: data.id as string,
    newValue: { title, type },
  });
  revalidateTemplates();
  return { ok: true, id: data.id as string };
}

/** Ofis şablonunu günceller (ad, tür, içerik). Global hazır şablonlar RLS ile değiştirilemez. */
export async function updateContractTemplate(
  _prev: ContractTemplateResult,
  fd: FormData,
): Promise<ContractTemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("id") ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const type = String(fd.get("type") ?? "").trim();
  const content = String(fd.get("content") ?? "").trim();
  if (!UUID.test(id)) return { error: "Şablon bulunamadı." };
  if (!title) return { error: "Şablon adı zorunludur." };
  if (title.length > 160) return { error: "Şablon adı en fazla 160 karakter olabilir." };
  if (!content) return { error: "Şablon içeriği boş olamaz." };
  if (content.length > 100_000) return { error: "Şablon içeriği çok uzun." };
  if (!(CONTRACT_TEMPLATE_TYPES as readonly string[]).includes(type)) return { error: "Geçersiz sözleşme türü." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .update({ title, type, content })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateContractTemplate", error);
    return { error: actionErrorMessage(error, "Şablon güncellenemedi.") };
  }
  if (!data) return { error: "Şablon bulunamadı (hazır şablonlar değiştirilemez)." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract_template.update",
    entityType: "contract_template",
    entityId: id,
    newValue: { title, type },
  });
  revalidateTemplates();
  return { ok: true, id };
}

/** Şablonu aktif/pasif yapar (pasif şablon yeni sözleşme formunda listelenmez). */
export async function setContractTemplateActive(id: string, active: boolean): Promise<ContractTemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Şablon bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .update({ is_active: Boolean(active) })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("setContractTemplateActive", error);
    return { error: actionErrorMessage(error, "Şablon durumu güncellenemedi.") };
  }
  if (!data) return { error: "Şablon bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: active ? "contract_template.activate" : "contract_template.deactivate",
    entityType: "contract_template",
    entityId: id,
  });
  revalidateTemplates();
  return { ok: true, id };
}

/** Ofis şablonunu siler (mevcut sözleşmeler içeriği kendi kopyasında taşıdığı için etkilenmez). */
export async function deleteContractTemplate(id: string): Promise<ContractTemplateResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(id)) return { error: "Şablon bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .select("id, title")
    .maybeSingle();
  if (error) {
    console.error("deleteContractTemplate", error);
    return { error: actionErrorMessage(error, "Şablon silinemedi.") };
  }
  if (!data) return { error: "Şablon bulunamadı." };

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract_template.delete",
    entityType: "contract_template",
    entityId: id,
    oldValue: { title: data.title },
  });
  revalidateTemplates();
  return { ok: true };
}
