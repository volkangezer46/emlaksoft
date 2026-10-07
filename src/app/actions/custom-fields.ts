"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import {
  CUSTOM_FIELD_MODULE,
  MAX_DEFS_PER_ENTITY,
  isCustomFieldEntity,
  isMissingCustomFieldSchema,
  keyFromLabel,
  parseDefInput,
  parseValue,
  toDef,
  type CustomFieldEntity,
} from "@/lib/custom-fields/core";
import { actionErrorMessage } from "@/lib/action-errors";

export type CustomFieldResult = { ok?: boolean; error?: string };

const SETTINGS_PATH = "/app/ayarlar/ozel-alanlar";
const UUID = /^[0-9a-f-]{36}$/i;
const NOT_READY = "Özel alanlar henüz etkin değil (veritabanı güncellemesi bekleniyor).";

const RECORD_TABLE: Record<CustomFieldEntity, string> = {
  customer: "customers",
  property: "properties",
  demand: "customer_demands",
  deal: "deals",
};
const RECORD_PATH: Record<CustomFieldEntity, (id: string) => string> = {
  customer: (id) => `/app/musteriler/${id}`,
  property: (id) => `/app/portfoyler/${id}`,
  demand: (id) => `/app/talepler/${id}`,
  deal: (id) => `/app/anlasmalar/${id}`,
};

/** Yeni alan tanımı (ayarlar:edit). Anahtar etiketten üretilir; çakışırsa sayı eklenir. */
export async function createCustomFieldDef(_prev: CustomFieldResult, formData: FormData): Promise<CustomFieldResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const entity = String(formData.get("entity") ?? "");
  if (!isCustomFieldEntity(entity)) return { error: "Geçersiz kayıt türü." };
  const parsed = parseDefInput({
    label: formData.get("label"),
    fieldType: formData.get("field_type"),
    options: formData.get("options"),
    required: formData.get("required"),
  });
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { data: existing, error: listError } = await supabase
    .from("custom_field_defs")
    .select("key, position")
    .eq("tenant_id", gate.tenantId)
    .eq("entity", entity)
    .limit(200);
  if (listError) return { error: isMissingCustomFieldSchema(listError) ? NOT_READY : actionErrorMessage(listError, "Alanlar okunamadı.") };
  const rows = (existing ?? []) as { key: string; position: number }[];
  if (rows.length >= MAX_DEFS_PER_ENTITY) return { error: `Bu kayıt türü için en çok ${MAX_DEFS_PER_ENTITY} alan tanımlanabilir.` };
  const taken = new Set(rows.map((r) => r.key));
  const base = keyFromLabel(parsed.value.label);
  let key = base;
  for (let i = 2; taken.has(key) && i < 100; i++) key = `${base.slice(0, 36)}_${i}`;
  const position = rows.reduce((m, r) => Math.max(m, Number(r.position) || 0), 0) + 1;

  const { error } = await supabase.from("custom_field_defs").insert({
    tenant_id: gate.tenantId,
    entity,
    key,
    label: parsed.value.label,
    field_type: parsed.value.fieldType,
    options: parsed.value.options,
    required: parsed.value.required,
    position: Math.min(position, 999),
    created_by: gate.userId,
  });
  if (error) {
    if (isMissingCustomFieldSchema(error)) return { error: NOT_READY };
    console.error("createCustomFieldDef", error.code);
    return { error: actionErrorMessage(error, "Alan eklenemedi.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "custom_field.create", entityType: "custom_field_def", newValue: { entity, key, type: parsed.value.fieldType } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** Etiket/seçenek/zorunluluk güncelleme (tür ve anahtar değişmez: mevcut değerler bozulmasın). */
export async function updateCustomFieldDef(_prev: CustomFieldResult, formData: FormData): Promise<CustomFieldResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Alan bulunamadı." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("custom_field_defs")
    .select("id, entity, key, label, field_type, options, required, position, active")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const def = row ? toDef(row as Record<string, unknown>) : null;
  if (!def) return { error: "Alan bulunamadı." };
  const parsed = parseDefInput({ label: formData.get("label"), fieldType: def.fieldType, options: formData.get("options"), required: formData.get("required") });
  if (!parsed.ok) return { error: parsed.error };
  if (def.fieldType === "select") {
    // Kullanılan bir seçenek kaldırılırsa eski değer okunur ama yeniden seçilemez: kullanıcıya açıkça söylenir.
    const removed = def.options.filter((o) => !parsed.value.options.includes(o));
    if (removed.length > 0) {
      const { count } = await supabase
        .from("custom_field_values")
        .select("record_id", { count: "exact", head: true })
        .eq("tenant_id", gate.tenantId)
        .eq("def_id", def.id)
        .in("value_text", removed);
      if ((count ?? 0) > 0) return { error: `Kaldırılan seçenek(ler) ${count} kayıtta kullanılıyor: ${removed.join(", ")}. Önce kayıtları güncelleyin.` };
    }
  }
  const { error } = await supabase
    .from("custom_field_defs")
    .update({ label: parsed.value.label, options: parsed.value.options, required: parsed.value.required, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Alan güncellenemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "custom_field.update", entityType: "custom_field_def", entityId: id });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** Alanı gizle/göster (değerler silinmez). */
export async function setCustomFieldActive(formData: FormData): Promise<CustomFieldResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!UUID.test(id)) return { error: "Alan bulunamadı." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_defs")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Alan güncellenemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: active ? "custom_field.activate" : "custom_field.deactivate", entityType: "custom_field_def", entityId: id });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** Alanı ve TÜM değerlerini kalıcı siler (yalnız ayarlar:edit + açık onay alanı). */
export async function deleteCustomFieldDef(formData: FormData): Promise<CustomFieldResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Alan bulunamadı." };
  if (String(formData.get("confirm") ?? "") !== "sil") return { error: "Silmeyi onaylamak için kutuya \"sil\" yazın." };
  const supabase = await createClient();
  const { error } = await supabase.from("custom_field_defs").delete().eq("id", id).eq("tenant_id", gate.tenantId);
  if (error) return { error: actionErrorMessage(error, "Alan silinemedi.") };
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "custom_field.delete", entityType: "custom_field_def", entityId: id });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/**
 * Kaydın özel alan değerlerini kaydeder. Form alan adları `cf_<def_id>`. Yetki: ilgili modülde edit (DB politikası da
 * aynı eşlemeyi + üst kayıt görünürlüğünü uygular). Boş değer = değer silinir.
 */
export async function saveCustomFieldValues(_prev: CustomFieldResult, formData: FormData): Promise<CustomFieldResult> {
  const entity = String(formData.get("entity") ?? "");
  if (!isCustomFieldEntity(entity)) return { error: "Geçersiz kayıt türü." };
  const gate = await requirePermission(CUSTOM_FIELD_MODULE[entity], "edit");
  if (!gate.ok) return { error: gate.error };
  const recordId = String(formData.get("record_id") ?? "");
  if (!UUID.test(recordId)) return { error: "Kayıt bulunamadı." };

  const supabase = await createClient();
  const { data: record } = await supabase.from(RECORD_TABLE[entity]).select("id").eq("id", recordId).eq("tenant_id", gate.tenantId).maybeSingle();
  if (!record) return { error: "Kayıt bulunamadı." };

  const { data: defRows, error: defError } = await supabase
    .from("custom_field_defs")
    .select("id, entity, key, label, field_type, options, required, position, active")
    .eq("tenant_id", gate.tenantId)
    .eq("entity", entity)
    .eq("active", true)
    .limit(200);
  if (defError) return { error: isMissingCustomFieldSchema(defError) ? NOT_READY : actionErrorMessage(defError, "Alanlar okunamadı.") };
  const defs = ((defRows ?? []) as Record<string, unknown>[]).map(toDef).filter((d) => d !== null);

  const upserts: Record<string, unknown>[] = [];
  const clears: string[] = [];
  for (const def of defs) {
    const field = `cf_${def.id}`;
    if (!formData.has(field)) continue;
    const parsed = parseValue(def, formData.get(field));
    if (!parsed.ok) return { error: parsed.error };
    if (parsed.empty) clears.push(def.id);
    else upserts.push({ def_id: def.id, tenant_id: gate.tenantId, entity, record_id: recordId, ...parsed.value, updated_by: gate.userId, updated_at: new Date().toISOString() });
  }
  if (upserts.length > 0) {
    const { error } = await supabase.from("custom_field_values").upsert(upserts, { onConflict: "def_id,record_id" });
    if (error) {
      console.error("saveCustomFieldValues", error.code);
      return { error: actionErrorMessage(error, "Özel alanlar kaydedilemedi.") };
    }
  }
  if (clears.length > 0) {
    const { error } = await supabase.from("custom_field_values").delete().eq("tenant_id", gate.tenantId).eq("record_id", recordId).in("def_id", clears);
    if (error) return { error: actionErrorMessage(error, "Özel alanlar kaydedilemedi.") };
  }
  await logActivity({ tenantId: gate.tenantId, actorId: gate.userId, action: "custom_field.values_update", entityType: entity, entityId: recordId, newValue: { set: upserts.length, cleared: clears.length } });
  revalidatePath(RECORD_PATH[entity](recordId));
  return { ok: true };
}
