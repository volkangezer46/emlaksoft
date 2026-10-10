import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, trDayKey, trMonthStartIso } from "@/lib/clock";
import { getDistrictsByIds, getNeighborhoodsByIds, getProvincesByIds } from "@/lib/geo/reader";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { OPEN_DEMAND_STATUSES } from "@/lib/team/advisor-360";
import { loadAdvisorResponseTimes, type MetricsViewer, currentMonthPeriod } from "@/lib/team/advisor-metrics";
import { explainSmart } from "./smart-assign";
import { unassignedSlaState } from "./logic";
import type { AssignmentHistoryFilter, OfficeAdvisorRow, OfficeStatistics, PoolAssignmentRow, UnassignedProperty } from "./types";

/**
 * Ofis Merkezi veri okuyucuları (sunucu). Oturumlu (RLS) istemci ile çalışır; tenant süzgeci HER sorguda açıktır.
 * Şema eksikse (migration uygulanmadı) ilgili bölüm boş/`available:false` döner, sayfa çökmez.
 * Tavanlar açıktır (PostgREST 1000 satır sınırı): tavana dayanan okuma `partial` işaretler.
 */
export type Db = SupabaseClient;
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const n = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Açık portföy tanımı: havuz ile aynı (draft/live/reserved). */
export const OPEN_LISTING_STATUSES = ["draft", "live", "reserved"] as const;
const SCAN = 10_000;
const ACTIVITY_SCAN = 2_000;

async function rows(q: PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>): Promise<{ rows: Row[]; failed: boolean; missing: boolean }> {
  const { data, error } = await q;
  if (error) return { rows: [], failed: !isMissingSchemaError(error), missing: isMissingSchemaError(error) };
  return { rows: Array.isArray(data) ? (data as Row[]) : [], failed: false, missing: false };
}

function tally(list: Row[], col: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of list) {
    const id = s(r[col]);
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/* -------------------------------------------------------------------------- */
/* Danışmanlar                                                                  */
/* -------------------------------------------------------------------------- */

export type AdvisorListResult = {
  rows: OfficeAdvisorRow[];
  branches: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  teamsAvailable: boolean;
  failed: boolean;
  partial: boolean;
};

export async function loadOfficeAdvisors(db: Db, tenantId: string, viewer: MetricsViewer, nowMs: number): Promise<AdvisorListResult> {
  const monthStart = trMonthStartIso(nowMs);
  const since90 = daysAgoIso(90);
  const today = trDayKey(nowMs);
  const period = currentMonthPeriod(nowMs);

  const [profilesRes, branchesRes, teamsRes, openProps, demands, won, leaves, calls, comms, createdProps, sla, specialtiesRes, regionsRes] = await Promise.all([
    rows(db.from("profiles").select("id, full_name, role, title, is_active, branch_id, team_id, created_at").eq("tenant_id", tenantId).order("full_name").limit(500)),
    rows(db.from("branches").select("id, name").eq("tenant_id", tenantId).limit(200)),
    rows(db.from("teams").select("id, name").eq("tenant_id", tenantId).limit(200)),
    rows(db.from("properties").select("assigned_to").eq("tenant_id", tenantId).in("status", [...OPEN_LISTING_STATUSES]).is("deleted_at", null).not("assigned_to", "is", null).limit(SCAN)),
    rows(
      db
        .from("customer_demands")
        .select("id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
        .eq("tenant_id", tenantId)
        .in("status", [...OPEN_DEMAND_STATUSES])
        .not("customer.assigned_to", "is", null)
        .limit(SCAN),
    ),
    rows(db.from("deals").select("assigned_to").eq("tenant_id", tenantId).eq("stage", "won").gte("updated_at", monthStart).not("assigned_to", "is", null).limit(SCAN)),
    rows(db.from("staff_leaves").select("staff_id").eq("tenant_id", tenantId).eq("status", "onayli").lte("starts_on", today).gte("ends_on", today).limit(1000)),
    rows(db.from("calls").select("handled_by, started_at").eq("tenant_id", tenantId).gte("started_at", since90).not("handled_by", "is", null).order("started_at", { ascending: false }).limit(ACTIVITY_SCAN)),
    rows(db.from("communications").select("created_by, created_at").eq("tenant_id", tenantId).gte("created_at", since90).not("created_by", "is", null).order("created_at", { ascending: false }).limit(ACTIVITY_SCAN)),
    rows(db.from("properties").select("created_by, created_at").eq("tenant_id", tenantId).gte("created_at", since90).not("created_by", "is", null).order("created_at", { ascending: false }).limit(ACTIVITY_SCAN)),
    loadAdvisorResponseTimes(db, { viewer, tenantId, period, nowMs }),
    // Uzmanlık / bölge sütunları: tablo yoksa (migration uygulanmadı) boş döner, liste bozulmaz.
    rows(db.from("advisor_specialties").select("profile_id, value, level").eq("tenant_id", tenantId).order("level", { ascending: false }).limit(2000)),
    rows(db.from("advisor_regions").select("profile_id, province_id, district_id, weight").eq("tenant_id", tenantId).order("weight", { ascending: false }).limit(2000)),
  ]);

  // profiles.team_id / title sütunu yoksa (takım migration'ı uygulanmamış) sade sorguya düş.
  let profiles = profilesRes.rows;
  let profilesFailed = profilesRes.failed;
  if (profilesRes.missing) {
    const fallback = await rows(db.from("profiles").select("id, full_name, role, is_active, branch_id, created_at").eq("tenant_id", tenantId).order("full_name").limit(500));
    profiles = fallback.rows;
    profilesFailed = fallback.failed;
  }

  const branchName = new Map(branchesRes.rows.map((b) => [s(b.id), s(b.name)]));
  const teamName = new Map(teamsRes.rows.map((t) => [s(t.id), s(t.name)]));
  const openBy = tally(openProps.rows, "assigned_to");
  const wonBy = tally(won.rows, "assigned_to");
  const demandBy = new Map<string, number>();
  for (const d of demands.rows) {
    const c = d.customer as Row | Row[] | null;
    const owner = s((Array.isArray(c) ? c[0] : c)?.assigned_to);
    if (owner) demandBy.set(owner, (demandBy.get(owner) ?? 0) + 1);
  }
  const onLeave = new Set(leaves.rows.map((r) => s(r.staff_id)));
  const lastActivity = new Map<string, number>();
  const note = (list: Row[], idCol: string, atCol: string) => {
    for (const r of list) {
      const id = s(r[idCol]);
      const at = Date.parse(s(r[atCol]));
      if (id && Number.isFinite(at) && (lastActivity.get(id) ?? 0) < at) lastActivity.set(id, at);
    }
  };
  note(calls.rows, "handled_by", "started_at");
  note(comms.rows, "created_by", "created_at");
  note(createdProps.rows, "created_by", "created_at");

  // Uzmanlık (ilk 3 değer) ve bölge (ilk 3 ilçe/il adı; ağırlığa göre) — danışman başına kısa özet.
  const specialtiesBy = new Map<string, string[]>();
  for (const r of specialtiesRes.rows) {
    const id = s(r.profile_id);
    const v = s(r.value);
    if (!id || !v) continue;
    const cur = specialtiesBy.get(id) ?? [];
    if (!cur.includes(v)) cur.push(v);
    specialtiesBy.set(id, cur);
  }
  const regionIds = (col: string) => [...new Set(regionsRes.rows.map((r) => s(r[col])).filter(Boolean))];
  const [regionDistricts, regionProvinces] = regionsRes.rows.length
    ? await Promise.all([getDistrictsByIds(regionIds("district_id")), getProvincesByIds(regionIds("province_id"))])
    : [[], []];
  const geoName = (list: unknown) => new Map(((list ?? []) as Row[]).map((g) => [s(g.id), s(g.name)]));
  const districtName = geoName(regionDistricts);
  const provinceName = geoName(regionProvinces);
  const regionsBy = new Map<string, string[]>();
  for (const r of regionsRes.rows) {
    const id = s(r.profile_id);
    const name = (s(r.district_id) ? districtName.get(s(r.district_id)) : undefined) ?? provinceName.get(s(r.province_id));
    if (!id || !name) continue;
    const cur = regionsBy.get(id) ?? [];
    if (!cur.includes(name)) cur.push(name);
    regionsBy.set(id, cur);
  }

  const list: OfficeAdvisorRow[] = profiles.map((p) => {
    const id = s(p.id);
    const branchId = s(p.branch_id) || null;
    const teamId = s(p.team_id) || null;
    const act = lastActivity.get(id);
    return {
      id,
      fullName: s(p.full_name) || "Danışman",
      role: s(p.role) || "advisor",
      title: s(p.title) || null,
      isActive: p.is_active !== false,
      branchId,
      branchName: branchId ? branchName.get(branchId) ?? null : null,
      teamId,
      teamName: teamId ? teamName.get(teamId) ?? null : null,
      createdAt: s(p.created_at),
      openProperties: openBy.get(id) ?? 0,
      openDemands: demandBy.get(id) ?? 0,
      wonThisMonth: wonBy.get(id) ?? 0,
      slaWithinPct: sla.byAdvisor.get(id)?.withinSlaPct ?? null,
      lastActivityAt: act ? new Date(act).toISOString() : null,
      onLeaveToday: onLeave.has(id),
      specialties: (specialtiesBy.get(id) ?? []).slice(0, 3),
      regions: (regionsBy.get(id) ?? []).slice(0, 3),
    };
  });

  const failed = profilesFailed || openProps.failed || demands.failed || won.failed || sla.failed;
  const partial = [openProps, demands, won].some((r) => r.rows.length >= SCAN) || [calls, comms, createdProps].some((r) => r.rows.length >= ACTIVITY_SCAN) || sla.partial;
  return {
    rows: list,
    branches: branchesRes.rows.map((b) => ({ id: s(b.id), name: s(b.name) })),
    teams: teamsRes.rows.map((t) => ({ id: s(t.id), name: s(t.name) })),
    teamsAvailable: !teamsRes.missing,
    failed,
    partial,
  };
}

/* -------------------------------------------------------------------------- */
/* Atamalar                                                                     */
/* -------------------------------------------------------------------------- */

export type UnassignedResult = { rows: UnassignedProperty[]; total: number; breached: number; failed: boolean; poolAvailable: boolean };

/** Danışmanı olmayan açık ilanlar (+ varsa havuz kaydı). `limit` ilk N; `total/breached` tam sayım. */
export async function loadUnassignedProperties(
  db: Db,
  tenantId: string,
  opts: { nowMs: number; slaHours: number; limit?: number; onlyBreached?: boolean; branchId?: string | null },
): Promise<UnassignedResult> {
  const limit = opts.limit ?? 50;
  let q = db
    .from("properties")
    .select("id, title, property_code, property_type, transaction_type, list_price, province_id, district_id, neighborhood_id, branch_id, created_at", { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("assigned_to", null)
    .is("deleted_at", null)
    .in("status", [...OPEN_LISTING_STATUSES])
    .order("created_at", { ascending: true })
    .limit(Math.min(limit * 4, 400));
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  const res = await q;
  if (res.error) return { rows: [], total: 0, breached: 0, failed: true, poolAvailable: true };
  const props = (res.data ?? []) as Row[];
  const ids = props.map((p) => s(p.id));

  const pool = ids.length
    ? await rows(db.from("listing_pool_entries").select("id, property_id, created_at, sla_due_at").eq("tenant_id", tenantId).eq("status", "pending").in("property_id", ids))
    : { rows: [] as Row[], failed: false, missing: false };
  const poolBy = new Map(pool.rows.map((e) => [s(e.property_id), e]));

  const geoIds = (key: string) => [...new Set(props.map((p) => s(p[key])).filter(Boolean))];
  const [nb, ds, pv] = await Promise.all([getNeighborhoodsByIds(geoIds("neighborhood_id")), getDistrictsByIds(geoIds("district_id")), getProvincesByIds(geoIds("province_id"))]);
  const nameOf = (list: unknown) => new Map(((list ?? []) as Row[]).map((r) => [s(r.id), s(r.name)]));
  const nbN = nameOf(nb);
  const dsN = nameOf(ds);
  const pvN = nameOf(pv);

  const all: UnassignedProperty[] = props.map((p) => {
    const entry = poolBy.get(s(p.id));
    const since = entry ? s(entry.created_at) : s(p.created_at);
    const sinceMs = Date.parse(since);
    return {
      id: s(p.id),
      title: s(p.title) || s(p.property_code) || "İlan",
      propertyCode: s(p.property_code) || null,
      propertyType: s(p.property_type) || null,
      transactionType: s(p.transaction_type) || null,
      listPrice: n(p.list_price),
      place: [nbN.get(s(p.neighborhood_id)), dsN.get(s(p.district_id)), pvN.get(s(p.province_id))].filter(Boolean).join(", "),
      branchId: s(p.branch_id) || null,
      createdAt: s(p.created_at),
      poolEntryId: entry ? s(entry.id) : null,
      poolSince: entry ? since : null,
      poolSlaDueAt: entry ? s(entry.sla_due_at) || null : null,
      slaState: Number.isFinite(sinceMs) ? unassignedSlaState(sinceMs, opts.nowMs, opts.slaHours) : "ok",
    };
  });
  const breached = all.filter((p) => p.slaState === "breached").length;
  const shown = (opts.onlyBreached ? all.filter((p) => p.slaState === "breached") : all).slice(0, limit);
  return { rows: shown, total: res.count ?? all.length, breached, failed: false, poolAvailable: !pool.missing };
}

export type AssignmentHistoryResult = { rows: PoolAssignmentRow[]; total: number; available: boolean; failed: boolean };

export async function loadPoolAssignmentHistory(
  db: Db,
  tenantId: string,
  opts: { filter: AssignmentHistoryFilter; limit?: number; branchAdvisorIds?: readonly string[] | null },
): Promise<AssignmentHistoryResult> {
  let q = db
    .from("pool_assignments")
    .select("id, property_id, assigned_to, previous_assignee, assigned_by, method, score, reason, status, created_at, cancelled_at, cancel_reason", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.filter === "aktif") q = q.eq("status", "active");
  else if (opts.filter === "iptal") q = q.eq("status", "cancelled");
  else if (opts.filter === "yeniden") q = q.eq("status", "reassigned");
  if (opts.branchAdvisorIds) q = q.in("assigned_to", opts.branchAdvisorIds.length ? [...opts.branchAdvisorIds] : ["00000000-0000-0000-0000-000000000000"]);
  const res = await q;
  if (res.error) return { rows: [], total: 0, available: !isMissingSchemaError(res.error), failed: !isMissingSchemaError(res.error) };
  const list = (res.data ?? []) as Row[];

  const propIds = [...new Set(list.map((r) => s(r.property_id)).filter(Boolean))];
  const profileIds = [...new Set(list.flatMap((r) => [s(r.assigned_to), s(r.previous_assignee), s(r.assigned_by)]).filter(Boolean))];
  const [props, profiles] = await Promise.all([
    propIds.length ? rows(db.from("properties").select("id, title, property_code").eq("tenant_id", tenantId).in("id", propIds)) : Promise.resolve({ rows: [] as Row[], failed: false, missing: false }),
    profileIds.length ? rows(db.from("profiles").select("id, full_name").eq("tenant_id", tenantId).in("id", profileIds)) : Promise.resolve({ rows: [] as Row[], failed: false, missing: false }),
  ]);
  const title = new Map(props.rows.map((p) => [s(p.id), s(p.title) || s(p.property_code) || "İlan"]));
  const name = new Map(profiles.rows.map((p) => [s(p.id), s(p.full_name) || "Danışman"]));

  return {
    rows: list.map((r) => {
      const score = (r.score ?? {}) as { total?: unknown; reasons?: { key: string; label: string; points: number; max: number }[] };
      const reasons = Array.isArray(score.reasons) ? score.reasons : [];
      return {
        id: s(r.id),
        propertyId: s(r.property_id),
        propertyTitle: title.get(s(r.property_id)) ?? "İlan",
        assignedTo: s(r.assigned_to),
        assignedToName: name.get(s(r.assigned_to)) ?? "Danışman",
        previousAssignee: s(r.previous_assignee) || null,
        previousAssigneeName: s(r.previous_assignee) ? name.get(s(r.previous_assignee)) ?? "Danışman" : null,
        assignedBy: s(r.assigned_by) || null,
        assignedByName: s(r.assigned_by) ? name.get(s(r.assigned_by)) ?? "Kullanıcı" : null,
        method: (s(r.method) || "manual") as PoolAssignmentRow["method"],
        scoreTotal: n(score.total),
        reasonSummary: reasons.length ? explainSmart(reasons) : null,
        reason: s(r.reason) || null,
        status: (s(r.status) || "active") as PoolAssignmentRow["status"],
        createdAt: s(r.created_at),
        cancelledAt: s(r.cancelled_at) || null,
        cancelReason: s(r.cancel_reason) || null,
      };
    }),
    total: res.count ?? list.length,
    available: true,
    failed: false,
  };
}

/* -------------------------------------------------------------------------- */
/* İstatistikler                                                                */
/* -------------------------------------------------------------------------- */

export async function loadOfficeStatistics(db: Db, tenantId: string, nowMs: number): Promise<OfficeStatistics & { assignmentsAvailable: boolean }> {
  const monthStart = trMonthStartIso(nowMs);
  const head = { count: "exact", head: true } as const;
  const base = (table: string) => db.from(table).select("id", head).eq("tenant_id", tenantId);
  const [total, live, unassigned, won, rentals, assigned, cancelled, active, inactive] = await Promise.all([
    base("properties").is("deleted_at", null).in("status", [...OPEN_LISTING_STATUSES]),
    base("properties").is("deleted_at", null).eq("status", "live"),
    base("properties").is("deleted_at", null).is("assigned_to", null).in("status", [...OPEN_LISTING_STATUSES]),
    base("deals").eq("stage", "won").gte("updated_at", monthStart),
    base("rentals").eq("status", "active"),
    base("pool_assignments").gte("created_at", monthStart),
    base("pool_assignments").eq("status", "cancelled").gte("created_at", monthStart),
    base("profiles").eq("is_active", true),
    base("profiles").eq("is_active", false),
  ]);
  const assignmentsAvailable = !isMissingSchemaError(assigned.error);
  const failed = [total, live, unassigned, won, active, inactive].some((r) => Boolean(r.error)) || (Boolean(rentals.error) && !isMissingSchemaError(rentals.error)) || (Boolean(assigned.error) && assignmentsAvailable);
  return {
    totalProperties: total.count ?? 0,
    liveProperties: live.count ?? 0,
    unassignedProperties: unassigned.count ?? 0,
    wonDealsThisMonth: won.count ?? 0,
    activeRentals: rentals.error ? 0 : rentals.count ?? 0,
    assignmentsThisMonth: assigned.error ? 0 : assigned.count ?? 0,
    cancelledAssignmentsThisMonth: cancelled.error ? 0 : cancelled.count ?? 0,
    activeAdvisors: active.count ?? 0,
    inactiveAdvisors: inactive.count ?? 0,
    failed,
    assignmentsAvailable,
  };
}
