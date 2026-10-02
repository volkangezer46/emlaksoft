import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid, validateTicketCategory } from "@/lib/support/ticket-contract";

export type TicketCategoryOption = { value: string; label: string };

/**
 * Platform ticket ekranı için global + ofise özel kategorileri birleştirir.
 * Service-role istemcisi yalnız bu sunucu içi yardımcıda yaşar; çağıran action
 * önce platform yetki kapısını ve UUID doğrulamasını uygulamak zorundadır.
 */
export async function loadTicketCategoryOptionsForTenant(
  tenantId: string,
): Promise<TicketCategoryOption[]> {
  if (!isUuid(tenantId)) throw new Error("Invalid tenant id for ticket categories.");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("definitions")
    .select("value, label, tenant_id, sort_order")
    .eq("category", "ticket_category")
    .eq("is_active", true)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Ticket category lookup failed: ${error.code ?? "unknown"}`);
  }

  const byValue = new Map<
    string,
    { value: string; label: string; sort: number; tenantScoped: boolean }
  >();
  for (const definition of data ?? []) {
    const value = String(definition.value ?? "").trim();
    const label = String(definition.label ?? "").trim();
    if (validateTicketCategory(value) || !label) continue;
    const tenantScoped = definition.tenant_id !== null;
    const existing = byValue.get(value);
    if (!existing || (tenantScoped && !existing.tenantScoped)) {
      byValue.set(value, {
        value,
        label,
        sort: definition.sort_order ?? 0,
        tenantScoped,
      });
    }
  }

  return [...byValue.values()]
    .sort((left, right) => left.sort - right.sort || left.label.localeCompare(right.label, "tr-TR"))
    .map(({ value, label }) => ({ value, label }));
}
