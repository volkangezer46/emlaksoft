import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type DefinitionCategory =
  | "customer_type"
  | "customer_source"
  | "property_type"
  | "transaction_type"
  | "contract_type";

export type DefinitionItem = { value: string; label: string; color: string | null };

/**
 * Kategoriye göre tanımları döndürür. RLS sayesinde sorgu hem global (tenant_id null)
 * hem de ofisin kendi tanımlarını getirir; ofis tanımı aynı value için global'i override eder.
 * Request başına cache'lenir.
 */
export const getDefinitions = cache(async (category: DefinitionCategory): Promise<DefinitionItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("definitions")
    .select("value, label, color, sort_order, tenant_id, is_active")
    .eq("category", category)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const rows = data ?? [];
  // Aynı value için ofis tanımı (tenant_id dolu) global'i geçersiz kılsın
  const byValue = new Map<string, { value: string; label: string; color: string | null; sort: number; tenantScoped: boolean }>();
  for (const r of rows) {
    const existing = byValue.get(r.value);
    const tenantScoped = r.tenant_id != null;
    if (!existing || (tenantScoped && !existing.tenantScoped)) {
      byValue.set(r.value, { value: r.value, label: r.label, color: r.color ?? null, sort: r.sort_order ?? 0, tenantScoped });
    }
  }
  return [...byValue.values()]
    .sort((a, b) => a.sort - b.sort)
    .map(({ value, label, color }) => ({ value, label, color }));
});

/** Etiket eşleme haritası (value → label) — rozet/gösterim için pratik. */
export function toLabelMap(items: DefinitionItem[]): Record<string, string> {
  return Object.fromEntries(items.map((i) => [i.value, i.label]));
}
