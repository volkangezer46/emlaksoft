import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettingDef, storageKeyOf } from "@/lib/settings/registry";
import { coerceInput } from "@/lib/settings/view";
import { MARKET_DATA_SHARE_KEY } from "@/lib/settings/registry/tenant";
import { aggregateMarketSignals, marketSignalRowFromView, type MarketSignalCell, type MarketSignalRow } from "./market-signals";

/**
 * Emlakfiyati anonim/agregat dışa aktarım okuyucusu. İstemciyi ÇAĞIRAN verir (platform route'unun kabul listesindeki
 * service_role istemcisi); bu modül kendi istemcisini oluşturmaz. Akış: opt-in açık ofisler → yalnız onların görünüm
 * satırları (sayfalı, PostgREST 1000 satır sınırı) → `aggregateMarketSignals` (k≥5, ofis alt sınırı) → hücreler.
 * Hücrede ofis kimliği / ilan / kişi verisi YOK.
 */
export const MARKET_EXPORT_MAX_ROWS = 100_000;
const PAGE = 1000;
const TENANT_CHUNK = 200;

export type MarketExportResult = {
  cells: MarketSignalCell[];
  optedInOffices: number;
  sourceRows: number;
  truncated: boolean;
  available: boolean;
};

export async function loadOptedInTenantIds(db: SupabaseClient): Promise<string[]> {
  const def = getSettingDef(MARKET_DATA_SHARE_KEY);
  if (!def) return [];
  const { data, error } = await db.from("tenant_settings").select("tenant_id, value").eq("key", storageKeyOf(def)).limit(10_000);
  if (error) {
    console.error("market export opt-in read", error.code);
    return [];
  }
  const ids: string[] = [];
  for (const r of (data ?? []) as { tenant_id: string; value: unknown }[]) {
    const parsed = coerceInput(def, r.value);
    if (parsed.ok && parsed.value === true && typeof r.tenant_id === "string") ids.push(r.tenant_id);
  }
  return ids;
}

export async function buildMarketExport(
  db: SupabaseClient,
  opts: { k?: number; minTenants?: number } = {},
): Promise<MarketExportResult> {
  const tenantIds = await loadOptedInTenantIds(db);
  if (tenantIds.length === 0) return { cells: [], optedInOffices: 0, sourceRows: 0, truncated: false, available: true };
  const rows: MarketSignalRow[] = [];
  let truncated = false;
  outer: for (let t = 0; t < tenantIds.length; t += TENANT_CHUNK) {
    const part = tenantIds.slice(t, t + TENANT_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("control_market_signals_v")
        .select("tenant_id, district_id, property_type, transaction_type, published_month, published_days, price_change_count, price_delta_pct, outcome, days_to_outcome")
        .in("tenant_id", part)
        .order("tenant_id", { ascending: true })
        .order("published_month", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("market export view read", error.code);
        return { cells: [], optedInOffices: tenantIds.length, sourceRows: 0, truncated: false, available: false };
      }
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const row = marketSignalRowFromView(r);
        if (row) rows.push(row);
      }
      if (rows.length >= MARKET_EXPORT_MAX_ROWS) {
        truncated = true;
        break outer;
      }
      if (!data || data.length < PAGE) break;
    }
  }
  const cells = aggregateMarketSignals(rows, {
    k: Math.max(5, opts.k ?? 5),
    minTenants: Math.max(1, opts.minTenants ?? 2),
    optedInTenantIds: new Set(tenantIds),
  });
  return { cells, optedInOffices: tenantIds.length, sourceRows: rows.length, truncated, available: true };
}
