import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso } from "@/lib/clock";
import { getDistrictsByIds, getNeighborhoodsByIds, getProvincesByIds } from "@/lib/geo/reader";
import { OPEN_DEMAND_STATUSES } from "@/lib/team/advisor-360";
import { currentMonthPeriod, type MetricsViewer, loadAdvisorResponseTimes } from "@/lib/team/advisor-metrics";
import { loadPoolCandidates, loadPoolRule, toPoolProperty } from "@/lib/pool/server";
import type { PoolProperty } from "@/lib/pool/score";
import { getSettings } from "@/lib/settings/read";
import { ASSIGN_WEIGHT_KEYS } from "@/lib/settings/registry/tenant";
import { rankAdvisorsForProperty, type SmartCandidate, type SmartSuggestion, type SmartWeights } from "./smart-assign";

/**
 * Akıllı atama için aday ve bağlam yükleyici (sunucu). Havuzun aday yükleyicisini (`loadPoolCandidates`: uzmanlık,
 * bölge, izin, açık ilan, kapasite, 90 gün performansı, son atama) YENİDEN YAZMAZ; üstüne açık talep, SLA uyumu,
 * son aktivite, şube/takım ekler. Ağırlıklar ofis ayar defterinden okunur.
 */
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const SCAN = 10_000;

async function safeRows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data, error } = await q;
  return error || !Array.isArray(data) ? [] : (data as Row[]);
}

export async function loadSmartWeights(tenantId: string): Promise<SmartWeights> {
  const keys = Object.values(ASSIGN_WEIGHT_KEYS);
  const v = await getSettings(keys, { tenantId });
  const num = (k: string, def: number) => (typeof v[k] === "number" ? (v[k] as number) : def);
  return {
    workload: num(ASSIGN_WEIGHT_KEYS.workload, 25),
    specialty: num(ASSIGN_WEIGHT_KEYS.specialty, 20),
    region: num(ASSIGN_WEIGHT_KEYS.region, 25),
    performance: num(ASSIGN_WEIGHT_KEYS.performance, 15),
    availability: num(ASSIGN_WEIGHT_KEYS.availability, 15),
  };
}

export type SmartBundle = {
  candidates: SmartCandidate[];
  officeAvgOpen: number;
  officeAvgLoad: number;
  weights: SmartWeights;
};

export async function loadSmartCandidates(db: SupabaseClient, tenantId: string, viewer: MetricsViewer, nowMs: number): Promise<SmartBundle> {
  const rule = await loadPoolRule(db, tenantId, null);
  const [{ candidates, officeAvgOpen }, profiles, demands, calls, comms, props, sla, weights] = await Promise.all([
    loadPoolCandidates(db, tenantId, nowMs, rule.id),
    safeRows(db.from("profiles").select("id, branch_id, team_id").eq("tenant_id", tenantId).limit(500)).then(async (r) =>
      r.length ? r : safeRows(db.from("profiles").select("id, branch_id").eq("tenant_id", tenantId).limit(500)),
    ),
    safeRows(
      db
        .from("customer_demands")
        .select("id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
        .eq("tenant_id", tenantId)
        .in("status", [...OPEN_DEMAND_STATUSES])
        .not("customer.assigned_to", "is", null)
        .limit(SCAN),
    ),
    safeRows(db.from("calls").select("handled_by, started_at").eq("tenant_id", tenantId).gte("started_at", daysAgoIso(90)).not("handled_by", "is", null).order("started_at", { ascending: false }).limit(2000)),
    safeRows(db.from("communications").select("created_by, created_at").eq("tenant_id", tenantId).gte("created_at", daysAgoIso(90)).not("created_by", "is", null).order("created_at", { ascending: false }).limit(2000)),
    safeRows(db.from("properties").select("created_by, created_at").eq("tenant_id", tenantId).gte("created_at", daysAgoIso(90)).not("created_by", "is", null).order("created_at", { ascending: false }).limit(2000)),
    loadAdvisorResponseTimes(db, { viewer, tenantId, period: currentMonthPeriod(nowMs), nowMs }),
    loadSmartWeights(tenantId),
  ]);

  const org = new Map(profiles.map((p) => [s(p.id), { branchId: s(p.branch_id) || null, teamId: s(p.team_id) || null }]));
  const demandBy = new Map<string, number>();
  for (const d of demands) {
    const c = d.customer as Row | Row[] | null;
    const owner = s((Array.isArray(c) ? c[0] : c)?.assigned_to);
    if (owner) demandBy.set(owner, (demandBy.get(owner) ?? 0) + 1);
  }
  const lastActivity = new Map<string, number>();
  const note = (list: Row[], idCol: string, atCol: string) => {
    for (const r of list) {
      const id = s(r[idCol]);
      const at = Date.parse(s(r[atCol]));
      if (id && Number.isFinite(at) && (lastActivity.get(id) ?? 0) < at) lastActivity.set(id, at);
    }
  };
  note(calls, "handled_by", "started_at");
  note(comms, "created_by", "created_at");
  note(props, "created_by", "created_at");

  const smart: SmartCandidate[] = candidates.map((c) => ({
    ...c,
    branchId: org.get(c.profileId)?.branchId ?? null,
    teamId: org.get(c.profileId)?.teamId ?? null,
    openDemands: demandBy.get(c.profileId) ?? 0,
    slaWithinPct: sla.byAdvisor.get(c.profileId)?.withinSlaPct ?? null,
    lastActivityAtMs: lastActivity.get(c.profileId) ?? null,
  }));
  const active = smart.filter((c) => c.isActive);
  const officeAvgLoad = active.length ? active.reduce((t, c) => t + c.openListings + c.openDemands, 0) / active.length : 0;
  return { candidates: smart, officeAvgOpen, officeAvgLoad, weights };
}

export type PropertyForAssign = {
  id: string;
  title: string;
  branchId: string | null;
  assignedTo: string | null;
  pool: PoolProperty;
  labels: { neighborhood?: string; district?: string; province?: string };
};

export async function loadPropertyForAssign(db: SupabaseClient, tenantId: string, propertyId: string): Promise<PropertyForAssign | null> {
  const { data } = await db
    .from("properties")
    .select("id, title, property_code, property_type, transaction_type, province_id, district_id, neighborhood_id, list_price, branch_id, assigned_to, deleted_at")
    .eq("id", propertyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const row = (data ?? null) as Row | null;
  if (!row || row.deleted_at) return null;
  const [nb, ds, pv] = await Promise.all([
    getNeighborhoodsByIds([s(row.neighborhood_id)].filter(Boolean)),
    getDistrictsByIds([s(row.district_id)].filter(Boolean)),
    getProvincesByIds([s(row.province_id)].filter(Boolean)),
  ]);
  const first = (list: unknown) => ((list ?? []) as Row[])[0]?.name as string | undefined;
  return {
    id: s(row.id),
    title: s(row.title) || s(row.property_code) || "İlan",
    branchId: s(row.branch_id) || null,
    assignedTo: s(row.assigned_to) || null,
    pool: toPoolProperty(row),
    labels: { neighborhood: first(nb), district: first(ds), province: first(pv) },
  };
}

/** Tek ilan için sıralı öneri (şube kısıtı dahil). */
export async function rankForProperty(
  db: SupabaseClient,
  tenantId: string,
  viewer: MetricsViewer,
  property: PropertyForAssign,
  nowMs: number,
  restrictToBranchId: string | null,
): Promise<{ ranked: SmartSuggestion[]; bundle: SmartBundle }> {
  const bundle = await loadSmartCandidates(db, tenantId, viewer, nowMs);
  const ranked = rankAdvisorsForProperty(property.pool, bundle.candidates, {
    nowMs,
    officeAvgOpen: bundle.officeAvgOpen,
    officeAvgLoad: bundle.officeAvgLoad,
    weights: bundle.weights,
    restrictToBranchId,
    labels: property.labels,
  });
  return { ranked, bundle };
}
