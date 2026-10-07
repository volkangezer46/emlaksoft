import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCustomFieldDefs } from "@/lib/custom-fields/load";
import { parseValue, type CustomFieldEntity, type ValueColumns } from "@/lib/custom-fields/core";

/**
 * Yeni kayıt formlarında özel alanlar (form alanı `cf_<def_id>`). Akış: kayıt YAZILMADAN önce `prepareCustomFieldInputs`
 * doğrular (zorunlu/tür hatası kaydı engeller), kayıt yazılınca `writeCustomFieldInputs` değerleri ekler. Değer RLS'i
 * (`custom_field_can_write`) aynı modül düzenleme iznini ister; yalnız oluşturma izni olan kullanıcıda yazım reddedilirse
 * kayıt kalır, değer detay ekranından girilir (false döner, çağıran uyarı verebilir). Tablo yoksa sessizce atlanır.
 */
export type PreparedCustomFields = { entity: CustomFieldEntity; rows: { defId: string; value: ValueColumns }[] };

export async function prepareCustomFieldInputs(
  db: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  formData: FormData,
): Promise<{ ok: true; value: PreparedCustomFields } | { ok: false; error: string }> {
  const hasAny = [...formData.keys()].some((k) => k.startsWith("cf_"));
  if (!hasAny) return { ok: true, value: { entity, rows: [] } };
  const { defs } = await loadCustomFieldDefs(db, tenantId, entity);
  const rows: PreparedCustomFields["rows"] = [];
  for (const def of defs) {
    const field = `cf_${def.id}`;
    if (!formData.has(field)) continue;
    const parsed = parseValue(def, formData.get(field));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (!parsed.empty) rows.push({ defId: def.id, value: parsed.value });
  }
  return { ok: true, value: { entity, rows } };
}

/** Yeni kayıt formu için etkin tanımlar (istemciye yalnız gerekli alanlar gider). Tablo yoksa boş. */
export async function loadCustomFieldInputDefs(
  db: SupabaseClient,
  tenantId: string | null | undefined,
  entity: CustomFieldEntity,
): Promise<{ id: string; label: string; fieldType: string; options: string[]; required: boolean }[]> {
  if (!tenantId) return [];
  const { defs } = await loadCustomFieldDefs(db, tenantId, entity);
  return defs.map((d) => ({ id: d.id, label: d.label, fieldType: d.fieldType, options: d.options, required: d.required }));
}

export async function writeCustomFieldInputs(
  db: SupabaseClient,
  ctx: { tenantId: string; userId: string; recordId: string },
  prepared: PreparedCustomFields,
): Promise<boolean> {
  if (prepared.rows.length === 0) return true;
  const stamp = new Date().toISOString();
  const { error } = await db.from("custom_field_values").upsert(
    prepared.rows.map((r) => ({
      def_id: r.defId,
      tenant_id: ctx.tenantId,
      entity: prepared.entity,
      record_id: ctx.recordId,
      ...r.value,
      updated_by: ctx.userId,
      updated_at: stamp,
    })),
    { onConflict: "def_id,record_id" },
  );
  if (error) console.error("writeCustomFieldInputs", error.code);
  return !error;
}
