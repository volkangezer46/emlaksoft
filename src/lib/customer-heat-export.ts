import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { computeCustomerHeat } from "@/lib/customer-state/core";
import { loadDormantDays } from "@/lib/customer-state/load";
import { applyCustomerFilters, HEAT_POOL_LIMIT, HEAT_RPC_CHUNK, type CustomerListFilters } from "@/lib/customer-list-filters";
import { hasOfficeWideDataScope } from "@/lib/permission-data-scope";

const CUSTOMER_EXPORT_COLS = "full_name, phone, email, customer_types, tags, source, created_at";

/** Segment filtresi: havuz (HEAT_POOL_LIMIT, ekranla aynı) skorlanır, eşleşenlerin tam kolonları çekilir. */
export async function filterCustomersByHeatSegment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gate: { tenantId: string; userId: string; role: string },
  filters: CustomerListFilters,
  segment: string,
): Promise<{ rows: Record<string, unknown>[]; error?: unknown }> {
  const scoped = <Q,>(q: Q): Q => (hasOfficeWideDataScope(gate.role) ? q : (q as unknown as { eq: (c: string, v: string) => Q }).eq("assigned_to", gate.userId));
  const { data: pool, error } = await scoped(
    applyCustomerFilters(
      supabase
        .from("customers")
        .select("id, created_at, blacklist")
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(HEAT_POOL_LIMIT),
      filters,
    ),
  );
  if (error) return { rows: [], error };
  const poolRows = (pool ?? []) as { id: string; created_at: string; blacklist: boolean | null }[];
  const signals = new Map<string, { last_contact: string | null; open_demands: number; urgent_demands: number; portal_likes_30d: number; open_offers: number; open_deals: number }>();
  for (let i = 0; i < poolRows.length; i += HEAT_RPC_CHUNK) {
    const ids = poolRows.slice(i, i + HEAT_RPC_CHUNK).map((r) => r.id);
    const res = await supabase.rpc("customer_heat_signals", { p_tenant_id: gate.tenantId, p_customer_ids: ids });
    if (res.error) return { rows: [], error: res.error };
    for (const s of (res.data ?? []) as { customer_id: string; last_contact: string | null; open_demands: number; urgent_demands: number; portal_likes_30d: number; open_offers: number; open_deals: number }[]) signals.set(s.customer_id, s);
  }
  const nowMs = now();
  // Ekranla aynı eşik: ofis tanımlı uykuda günü + ortak ısı hesabı (customer-state).
  const dormantDays = await loadDormantDays(gate.tenantId);
  const matching = poolRows.filter(
    (r) => computeCustomerHeat({ createdAt: r.created_at, blacklist: Boolean(r.blacklist) }, signals.get(r.id) ?? null, nowMs, { dormantDays }).segment === segment,
  );
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < matching.length; i += 200) {
    const ids = matching.slice(i, i + 200).map((r) => r.id);
    const { data, error: e2 } = await supabase
      .from("customers")
      .select(CUSTOMER_EXPORT_COLS)
      .eq("tenant_id", gate.tenantId)
      .in("id", ids);
    if (e2) return { rows: [], error: e2 };
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
  }
  rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { rows };
}

