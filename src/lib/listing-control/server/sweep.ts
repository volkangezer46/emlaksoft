import { now } from "@/lib/clock";
import { loadListingControlConfig, isMissingSchema, type Db } from "./db";
import { syncProperties, type SyncSummary } from "./sync";
import type { ListingControlConfig } from "../config";
import { normalizeListingControlConfig } from "../config";

/**
 * Değerlendirme TARAMASI (cron): hiç değerlendirilmemiş ya da bayatlamış atanmış portföyleri (en eskiden başlayarak)
 * ofis ofis gruplayıp motorla eşitler. Yayınlanmayan portföy (24/48 saat), yetki bitişi ve yavaş değişen koşulları
 * yakalar; kontrol sonucu olayları ayrıca ANINDA senkronlar (`processCheckResult`). Tur başına üst sınır ve zaman
 * bütçesi vardır; kalan iş sonraki turda sürer (en eski önce). Şema yoksa 0 işler.
 */

export type SweepSummary = SyncSummary & { candidates: number; tenants: number };

export async function runControlSweep(
  db: Db,
  nowMs: number,
  opts: { limit?: number; staleHours?: number; deadlineMs?: number; disabledTenantIds?: ReadonlySet<string> } = {},
): Promise<SweepSummary> {
  const empty: SweepSummary = {
    candidates: 0,
    tenants: 0,
    examined: 0,
    skipped: 0,
    anomaliesOpened: 0,
    anomaliesReopened: 0,
    anomaliesClosed: 0,
    statesWritten: 0,
    schemaMissing: false,
  };
  const { data, error } = await db.rpc("lc_sweep_candidates", { p_limit: opts.limit ?? 300, p_stale_hours: opts.staleHours ?? 6 });
  if (error) {
    if (isMissingSchema(error)) return { ...empty, schemaMissing: true };
    console.error("lc_sweep_candidates", { code: error.code });
    return empty;
  }
  const candidates = ((data ?? []) as { tenant_id: string; property_id: string }[]).filter((c) => !opts.disabledTenantIds?.has(c.tenant_id));
  const byTenant = new Map<string, string[]>();
  for (const c of candidates) byTenant.set(c.tenant_id, [...(byTenant.get(c.tenant_id) ?? []), c.property_id]);

  const out: SweepSummary = { ...empty, candidates: candidates.length, tenants: byTenant.size };
  const cfgCache = new Map<string, ListingControlConfig>();
  for (const [tenantId, ids] of byTenant) {
    if (opts.deadlineMs !== undefined && now() >= opts.deadlineMs) break;
    let cfg = cfgCache.get(tenantId);
    if (!cfg) {
      cfg = (await loadListingControlConfig(db, tenantId)) ?? normalizeListingControlConfig(null);
      cfgCache.set(tenantId, cfg);
    }
    const r = await syncProperties(db, tenantId, ids, cfg, nowMs);
    out.examined += r.examined;
    out.skipped += r.skipped;
    out.anomaliesOpened += r.anomaliesOpened;
    out.anomaliesReopened += r.anomaliesReopened;
    out.anomaliesClosed += r.anomaliesClosed;
    out.statesWritten += r.statesWritten;
    out.schemaMissing = out.schemaMissing || r.schemaMissing;
    if (r.schemaMissing) break;
  }
  return out;
}
