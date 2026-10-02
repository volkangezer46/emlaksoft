import type { SupabaseClient } from "@supabase/supabase-js";
import type { DefinitionCategory } from "@/lib/definition-defaults";

/**
 * Bir tanım değerinin hangi tablo/kolonlarda saklandığı. Silmeden önce referans
 * sayımı bunlardan yapılır. `array: true` → text[] kolon (contains).
 */
export const DEFINITION_USAGE_REFS: Record<
  DefinitionCategory,
  readonly { table: string; column: string; array?: boolean; softDelete?: boolean }[]
> = {
  customer_type: [{ table: "customers", column: "customer_types", array: true, softDelete: true }],
  customer_source: [{ table: "customers", column: "source", softDelete: true }],
  property_type: [
    { table: "properties", column: "property_type", softDelete: true },
    { table: "demands", column: "property_type" },
  ],
  transaction_type: [
    { table: "properties", column: "transaction_type", softDelete: true },
    { table: "demands", column: "transaction_type" },
  ],
  contract_type: [{ table: "contracts", column: "contract_type" }],
  expense_category: [{ table: "expenses", column: "category" }],
  appointment_type: [{ table: "appointments", column: "appointment_type" }],
  demand_urgency: [{ table: "demands", column: "urgency" }],
  ticket_category: [{ table: "support_tickets", column: "category" }],
};

/**
 * Tenant filtresiyle toplam referans sayısı. Sayım hatasında `null` döner
 * (çağıran güvenli tarafta kalıp silmeyi engellemeli).
 */
export async function countDefinitionUsage(
  supabase: SupabaseClient,
  tenantId: string,
  category: DefinitionCategory,
  value: string,
): Promise<number | null> {
  let total = 0;
  for (const ref of DEFINITION_USAGE_REFS[category]) {
    let q = supabase
      .from(ref.table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    q = ref.array ? q.contains(ref.column, [value]) : q.eq(ref.column, value);
    if (ref.softDelete) q = q.is("deleted_at", null);
    const { count, error } = await q;
    if (error) return null;
    total += count ?? 0;
  }
  return total;
}
