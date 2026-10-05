import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnedProperty = {
  id: string;
  title: string | null;
  propertyCode: string | null;
  status: string;
  transactionType: string | null;
  listPrice: number | null;
};

export type OwnedPropertiesResult =
  /** `properties.owner_customer_id` kolonu bu veritabanında yok (migration uygulanmadı): özellik etkin değil. */
  | { enabled: false }
  | { enabled: true; properties: OwnedProperty[]; total: number };

const LIMIT = 20;

/**
 * Müşterinin MALİK olduğu taşınmazlar — YALNIZ OKUMA (yazma tarafı P-HAVUZ `property-owner` alanındadır).
 * Kolon yokken (migration `supabase/proposed/20261005000100_properties_owner_customer_link.sql`
 * uygulanmamışken) sorgu hata verir; bu durum hata değil "etkin değil" sayılır ve kart gizlenir.
 */
export async function loadOwnedProperties(
  supabase: SupabaseClient,
  customerId: string,
  tenantId: string | null,
): Promise<OwnedPropertiesResult> {
  let q = supabase
    .from("properties")
    .select("id, title, property_code, status, transaction_type, list_price", { count: "exact" })
    .eq("owner_customer_id", customerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const res = await q;
  if (res.error) return { enabled: false };
  const rows = (res.data ?? []) as Record<string, unknown>[];
  return {
    enabled: true,
    total: res.count ?? rows.length,
    properties: rows.map((r) => ({
      id: String(r.id),
      title: (r.title as string | null) ?? null,
      propertyCode: (r.property_code as string | null) ?? null,
      status: String(r.status ?? ""),
      transactionType: (r.transaction_type as string | null) ?? null,
      listPrice: r.list_price == null ? null : Number(r.list_price),
    })),
  };
}
