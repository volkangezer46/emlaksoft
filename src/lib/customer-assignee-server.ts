import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { SALES_ASSIGNEE_ROLES } from "@/lib/team/assignable-roles";
import { suggestLeastLoadedAssignee, type AssigneeSuggestion } from "@/lib/customer-assignee";

/**
 * Yeni müşteri formunda yöneticinin "Danışman" seçicisi: aktif satış ekibi + en az yüklü öneri (sayfalı okuma; tüm ofis
 * müşterilerinin sorumlusu). Okuma hatası öneriyi düşürür (uydurma yok), ekip listesi yine gösterilir.
 */
export async function loadCustomerAssigneeOptions(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ members: { id: string; name: string }[]; suggestion: AssigneeSuggestion | null }> {
  const [membersRes, loads] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role").eq("tenant_id", tenantId).eq("is_active", true).in("role", [...SALES_ASSIGNEE_ROLES]).order("full_name"),
    readAllPaged<{ assigned_to: string | null }>((from, to) =>
      supabase.from("customers").select("assigned_to").eq("tenant_id", tenantId).is("deleted_at", null).not("assigned_to", "is", null).order("id").range(from, to),
    ),
  ]);
  const members = ((membersRes.data ?? []) as { id: string; full_name: string | null; role: string }[]).map((m) => ({
    id: m.id,
    name: (m.full_name ?? "").trim() || "Danışman",
    role: m.role,
  }));
  const suggestion = loads.error ? null : suggestLeastLoadedAssignee(members, loads.rows.map((r) => r.assigned_to));
  return { members: members.map(({ id, name }) => ({ id, name })), suggestion };
}
