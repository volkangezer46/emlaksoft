import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCustomFieldDefs } from "@/lib/custom-fields/load";
import type { CustomFieldDef, CustomFieldEntity } from "@/lib/custom-fields/core";

/**
 * Özel alan liste filtresi — URL kontratı `?ozel=<anahtar>:<değer>` (tek filtre; müşteri / portföy / talep / anlaşma).
 * Sunucu: değer tablosundan eşleşen kayıt kimlikleri okunur (RLS'li istemci + AÇIK tenant_id), liste sorgusu
 * `.in("id", ids)` ile daraltılır. Metin alanı içerir (ilike), diğerleri tam eşleşme. Eşleşme tavanı 1000 kimlik
 * (PostgREST URL sınırı); tavan aşılırsa `capped` döner, ekran bunu söyler. Tablo yoksa filtre yok sayılır.
 */
export const CUSTOM_FILTER_PARAM = "ozel";
export const CUSTOM_FILTER_MAX_IDS = 1000;
/** Eşleşme yokken sorguyu boşaltmak için kullanılan imkânsız kimlik. */
export const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

export type CustomFieldFilterState = {
  defs: CustomFieldDef[];
  active: { def: CustomFieldDef; value: string } | null;
  /** null = filtre yok; [] = eşleşme yok. */
  ids: string[] | null;
  capped: boolean;
};

/** Saf: `anahtar:değer` ayrıştırma (değer 1-200 karakter, anahtar tanımlı ve etkin olmalı). */
export function parseCustomFilterParam(raw: string | string[] | undefined, defs: readonly CustomFieldDef[]): { def: CustomFieldDef; value: string } | null {
  const v = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const i = v.indexOf(":");
  if (i <= 0) return null;
  const key = v.slice(0, i);
  const value = v.slice(i + 1).trim().slice(0, 200);
  const def = defs.find((d) => d.key === key);
  if (!def || !value) return null;
  if (def.fieldType === "boolean" && value !== "evet" && value !== "hayir") return null;
  if (def.fieldType === "number" && !Number.isFinite(Number(value.replace(",", ".")))) return null;
  if (def.fieldType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (def.fieldType === "select" && !def.options.includes(value)) return null;
  return { def, value };
}

/** Ham parametre: `ozel` ya da filtre çubuğu formunun gönderdiği `ozel_alan` + `ozel_deger` (aynı kontrata indirgenir). */
export function customFilterRaw(sp: Record<string, string | string[] | undefined>): string | undefined {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const direct = one(sp[CUSTOM_FILTER_PARAM]);
  if (direct) return direct;
  const key = one(sp.ozel_alan);
  const value = one(sp.ozel_deger).trim();
  return key && value ? `${key}:${value}` : undefined;
}

/** URL değeri (filtre çubuğu ve çip bağlantıları). */
export function customFilterValue(key: string, value: string): string {
  return `${key}:${value}`;
}

export async function resolveCustomFieldFilter(
  db: SupabaseClient,
  tenantId: string | null,
  entity: CustomFieldEntity,
  raw: string | string[] | undefined,
): Promise<CustomFieldFilterState> {
  if (!tenantId) return { defs: [], active: null, ids: null, capped: false };
  const { defs } = await loadCustomFieldDefs(db, tenantId, entity);
  const active = parseCustomFilterParam(raw, defs);
  if (!active) return { defs, active: null, ids: null, capped: false };
  let q = db
    .from("custom_field_values")
    .select("record_id")
    .eq("tenant_id", tenantId)
    .eq("entity", entity)
    .eq("def_id", active.def.id)
    .limit(CUSTOM_FILTER_MAX_IDS + 1);
  const v = active.value;
  if (active.def.fieldType === "text") q = q.ilike("value_text", `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  else if (active.def.fieldType === "select") q = q.eq("value_text", v);
  else if (active.def.fieldType === "number") q = q.eq("value_num", Number(v.replace(",", ".")));
  else if (active.def.fieldType === "date") q = q.eq("value_date", v);
  else q = q.eq("value_bool", v === "evet");
  const { data, error } = await q;
  if (error) {
    console.error("resolveCustomFieldFilter", error.code);
    return { defs, active, ids: [], capped: false };
  }
  const ids = [...new Set((data ?? []).map((r) => String((r as { record_id: string }).record_id)))];
  return { defs, active, ids: ids.slice(0, CUSTOM_FILTER_MAX_IDS), capped: ids.length > CUSTOM_FILTER_MAX_IDS };
}

/** Liste sorgusuna uygular (filtre yoksa sorgu aynen döner). */
export function applyCustomFieldIds<Q extends { in: (column: string, values: readonly string[]) => Q }>(query: Q, ids: string[] | null, column = "id"): Q {
  if (ids === null) return query;
  return query.in(column, ids.length > 0 ? ids : [NO_MATCH_ID]);
}
