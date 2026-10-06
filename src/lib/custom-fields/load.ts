import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  csvColumnName,
  formatValue,
  isMissingCustomFieldSchema,
  toDef,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldValueRow,
} from "@/lib/custom-fields/core";

/**
 * Özel alan okuyucuları — çağıranın (oturumlu, RLS'li) istemcisiyle; her sorgu AÇIK tenant_id filtreli.
 * Tablo yoksa (migration uygulanmadı) `available: false` döner; çağıran bölümü gizler.
 */
export type DefsResult = { available: boolean; defs: CustomFieldDef[] };

export async function loadCustomFieldDefs(db: SupabaseClient, tenantId: string, entity: CustomFieldEntity | null, opts?: { includeInactive?: boolean }): Promise<DefsResult> {
  let q = db
    .from("custom_field_defs")
    .select("id, entity, key, label, field_type, options, required, position, active")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200);
  if (entity) q = q.eq("entity", entity);
  if (!opts?.includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    if (!isMissingCustomFieldSchema(error)) console.error("loadCustomFieldDefs", error.code);
    return { available: !isMissingCustomFieldSchema(error), defs: [] };
  }
  return { available: true, defs: ((data ?? []) as Record<string, unknown>[]).map(toDef).filter((d): d is CustomFieldDef => d !== null) };
}

export async function loadCustomFieldValues(db: SupabaseClient, tenantId: string, entity: CustomFieldEntity, recordIds: readonly string[]): Promise<Map<string, Map<string, CustomFieldValueRow>>> {
  const out = new Map<string, Map<string, CustomFieldValueRow>>();
  const ids = [...new Set(recordIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("custom_field_values")
      .select("def_id, record_id, value_text, value_num, value_date, value_bool")
      .eq("tenant_id", tenantId)
      .eq("entity", entity)
      .in("record_id", ids.slice(i, i + 200))
      .limit(5000);
    if (error) return out;
    for (const r of (data ?? []) as CustomFieldValueRow[]) {
      const m = out.get(r.record_id) ?? new Map<string, CustomFieldValueRow>();
      m.set(r.def_id, r);
      out.set(r.record_id, m);
    }
  }
  return out;
}

/**
 * CSV için özel alan sütunları: tüm satırlarda AYNI sütun kümesi (boş = ""), sütun adı `ozel: <etiket>`.
 * Tanım yoksa/tablo yoksa boş sütun listesi döner (CSV değişmez).
 */
export async function customFieldCsvColumns(
  db: SupabaseClient,
  tenantId: string,
  entity: CustomFieldEntity,
  recordIds: readonly string[],
): Promise<{ columns: string[]; forRecord: (id: string) => Record<string, string> }> {
  const { defs } = await loadCustomFieldDefs(db, tenantId, entity);
  if (defs.length === 0 || recordIds.length === 0) return { columns: [], forRecord: () => ({}) };
  const values = await loadCustomFieldValues(db, tenantId, entity, recordIds);
  const columns = defs.map(csvColumnName);
  return {
    columns,
    forRecord: (id) => {
      const rowValues = values.get(id);
      const out: Record<string, string> = {};
      for (const d of defs) out[csvColumnName(d)] = formatValue(d, rowValues?.get(d.id));
      return out;
    },
  };
}
