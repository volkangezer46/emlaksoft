"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import type { PriceField, PriceHistoryRow } from "@/lib/price-history";

/**
 * Bir portföyün fiyat tarihçesini kronolojik (eskiden yeniye) döndürür.
 *
 * Kayıtlar `trg_property_price_history` trigger'ı ile düşer; burada yalnızca
 * okuma var. RLS zaten tenant sınırını çiziyor ama modül yetkisi ayrıca
 * doğrulanıyor — Server Function'lar UI dışından, doğrudan POST ile de
 * çağrılabiliyor.
 */
export async function getPropertyPriceHistory(
  propertyId: string,
  priceField: PriceField = "list_price",
): Promise<PriceHistoryRow[]> {
  const gate = await requirePermission("properties", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("property_price_history")
    .select("id, price_field, old_price, new_price, change_pct, reason, created_at, changed_by:profiles(full_name)")
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .eq("price_field", priceField)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("getPropertyPriceHistory", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    ...row,
    old_price: row.old_price != null ? Number(row.old_price) : null,
    new_price: Number(row.new_price),
    change_pct: row.change_pct != null ? Number(row.change_pct) : null,
  })) as PriceHistoryRow[];
}
