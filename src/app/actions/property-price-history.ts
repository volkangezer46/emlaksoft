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
  // _fx görünümü: her kaydın o günkü TCMB kuruyla USD/EUR karşılığı.
  // security_invoker açık olduğu için ana tablonun RLS'i aynen geçerli.
  // Not: görünümde changed_by ham uuid; profil adı ayrı sorguda çözülür
  // (görünüme join gömmek RLS zincirini karmaşıklaştırıyordu).
  const { data, error } = await supabase
    .from("property_price_history_fx")
    .select(
      "id, price_field, old_price, new_price, change_pct, reason, created_at, changed_by, fx_date, new_price_usd, new_price_eur, old_price_usd, old_price_eur",
    )
    .eq("property_id", propertyId)
    .eq("tenant_id", gate.tenantId)
    .eq("price_field", priceField)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("getPropertyPriceHistory", error);
    return [];
  }

  const rows = data ?? [];

  // Aktör adlarını tek sorguda çöz
  const actorIds = [...new Set(rows.map((r) => r.changed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  return rows.map((row) => ({
    ...row,
    old_price: row.old_price != null ? Number(row.old_price) : null,
    new_price: Number(row.new_price),
    change_pct: row.change_pct != null ? Number(row.change_pct) : null,
    new_price_usd: row.new_price_usd != null ? Number(row.new_price_usd) : null,
    new_price_eur: row.new_price_eur != null ? Number(row.new_price_eur) : null,
    old_price_usd: row.old_price_usd != null ? Number(row.old_price_usd) : null,
    old_price_eur: row.old_price_eur != null ? Number(row.old_price_eur) : null,
    changed_by: row.changed_by
      ? { full_name: names.get(String(row.changed_by)) }
      : null,
  })) as PriceHistoryRow[];
}
