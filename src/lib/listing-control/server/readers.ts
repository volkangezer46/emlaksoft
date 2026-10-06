import { buildChainStats, type ChainStats } from "../chain";
import type { KpiKey, ScopeKind } from "../types";
import { isMissingSchema, type Db } from "./db";

/**
 * UI paketi için OKUYUCULAR. Hepsi KULLANICI OTURUMU istemcisiyle çağrılır (RLS + `lc_row_visible` kapsamı: danışman
 * kendi, takım lideri takım, şube müdürü şube, owner/gm şirket); service_role GEREKTİRMEZ. Tablolar/RPC'ler yokken
 * (migration uygulanmamış) `available: false` döner ve ekran boş durum gösterir.
 * Sayfa kapısı çağıranda: `requireModulePage("portals")` + rol/paket kuralı.
 */

export type ControlSummaryRow = {
  group_kind: ScopeKind;
  group_id: string | null;
  total_active: number;
  in_portals: number;
  awaiting_publish: number;
  portal_missing: number;
  price_mismatch: number;
  in_review: number;
  unverifiable: number;
  healthy: number;
  healthy_ratio: number | null;
};

export type ControlListRow = {
  property_id: string;
  risk_score: number;
  health_score: number | null;
  health_color: string | null;
  lifecycle_stage: string;
  advisor_id: string | null;
  branch_id: string | null;
  team_id: string | null;
  open_anomalies: number;
  portals_live: number;
  last_verified_at: string | null;
};

export type ControlChanges = {
  anomalies_opened: number;
  anomalies_closed: number;
  newly_missing: number;
  recovered: number;
  checks_total: number;
  checks_unverifiable: number;
};

const num = (v: unknown) => Number(v ?? 0);

/** KPI kartları (rol kapsamlı). groupBy='tenant' tek satır; 'branch'|'team'|'advisor' kırılım. */
export async function getControlSummary(
  db: Db,
  groupBy: ScopeKind = "tenant",
  includeSample = false,
): Promise<{ available: boolean; rows: ControlSummaryRow[] }> {
  const { data, error } = await db.rpc("listing_control_summary", { p_group_by: groupBy, p_include_sample: includeSample });
  if (error) {
    if (!isMissingSchema(error)) console.error("listing_control_summary", { code: error.code });
    return { available: false, rows: [] };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    group_kind: r.group_kind as ScopeKind,
    group_id: (r.group_id as string | null) ?? null,
    total_active: num(r.total_active),
    in_portals: num(r.in_portals),
    awaiting_publish: num(r.awaiting_publish),
    portal_missing: num(r.portal_missing),
    price_mismatch: num(r.price_mismatch),
    in_review: num(r.in_review),
    unverifiable: num(r.unverifiable),
    healthy: num(r.healthy),
    healthy_ratio: r.healthy_ratio === null || r.healthy_ratio === undefined ? null : Number(r.healthy_ratio),
  }));
  return { available: true, rows };
}

/** KPI kartının hedef listesi (sayı ile AYNI k_* kolonu). Keyset sayfalama: `after` bir önceki sayfanın son satırı. */
export async function listControlProperties(
  db: Db,
  kpi: KpiKey,
  opts: { groupBy?: ScopeKind; groupId?: string | null; limit?: number; after?: { riskScore: number; propertyId: string } | null; includeSample?: boolean } = {},
): Promise<{ available: boolean; rows: ControlListRow[]; nextCursor: { riskScore: number; propertyId: string } | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { data, error } = await db.rpc("listing_control_list", {
    p_kpi: kpi,
    p_group_by: opts.groupBy ?? "tenant",
    p_group_id: opts.groupId ?? null,
    p_limit: limit,
    p_after_risk: opts.after?.riskScore ?? null,
    p_after_id: opts.after?.propertyId ?? null,
    p_include_sample: opts.includeSample ?? false,
  });
  if (error) {
    if (!isMissingSchema(error)) console.error("listing_control_list", { code: error.code });
    return { available: false, rows: [], nextCursor: null };
  }
  const rows = ((data ?? []) as ControlListRow[]).map((r) => ({ ...r, risk_score: num(r.risk_score), open_anomalies: num(r.open_anomalies), portals_live: num(r.portals_live) }));
  const last = rows[rows.length - 1];
  return { available: true, rows, nextCursor: rows.length === limit && last ? { riskScore: last.risk_score, propertyId: last.property_id } : null };
}

export type DistrictSummaryRow = {
  district_id: string | null;
  district_name: string | null;
  total_active: number;
  in_portals: number;
  awaiting_publish: number;
  portal_missing: number;
  price_mismatch: number;
  in_review: number;
  unverifiable: number;
  healthy: number;
};

/** Bölge (ilçe) kırılımı (20261007000220; rol kapsamlı, sayı = liste). RPC yoksa available:false. */
export async function getDistrictSummary(db: Db, includeSample = false): Promise<{ available: boolean; rows: DistrictSummaryRow[] }> {
  const { data, error } = await db.rpc("listing_control_district_summary", { p_include_sample: includeSample });
  if (error) {
    if (!isMissingSchema(error)) console.error("listing_control_district_summary", { code: error.code });
    return { available: false, rows: [] };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    district_id: (r.district_id as string | null) ?? null,
    district_name: (r.district_name as string | null) ?? null,
    total_active: num(r.total_active),
    in_portals: num(r.in_portals),
    awaiting_publish: num(r.awaiting_publish),
    portal_missing: num(r.portal_missing),
    price_mismatch: num(r.price_mismatch),
    in_review: num(r.in_review),
    unverifiable: num(r.unverifiable),
    healthy: num(r.healthy),
  }));
  return { available: true, rows };
}

/** İlçe filtreli KPI listesi (sayı ile AYNI k_* kolonu; `districtId` null = ilçesi girilmemiş portföyler). */
export async function listControlPropertiesByDistrict(
  db: Db,
  kpi: KpiKey,
  districtId: string | null,
  opts: { limit?: number; after?: { riskScore: number; propertyId: string } | null; includeSample?: boolean } = {},
): Promise<{ available: boolean; rows: ControlListRow[]; nextCursor: { riskScore: number; propertyId: string } | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { data, error } = await db.rpc("listing_control_list_district", {
    p_kpi: kpi,
    p_district_id: districtId,
    p_limit: limit,
    p_after_risk: opts.after?.riskScore ?? null,
    p_after_id: opts.after?.propertyId ?? null,
    p_include_sample: opts.includeSample ?? false,
  });
  if (error) {
    if (!isMissingSchema(error)) console.error("listing_control_list_district", { code: error.code });
    return { available: false, rows: [], nextCursor: null };
  }
  const rows = ((data ?? []) as ControlListRow[]).map((r) => ({ ...r, risk_score: num(r.risk_score), open_anomalies: num(r.open_anomalies), portals_live: num(r.portals_live) }));
  const last = rows[rows.length - 1];
  return { available: true, rows, nextCursor: rows.length === limit && last ? { riskScore: last.risk_score, propertyId: last.property_id } : null };
}

/** "Dünden beri değişenler". */
export async function getChangesSince(db: Db, sinceIso: string): Promise<{ available: boolean; changes: ControlChanges | null }> {
  const { data, error } = await db.rpc("listing_control_changes_since", { p_since: sinceIso });
  if (error) {
    if (!isMissingSchema(error)) console.error("listing_control_changes_since", { code: error.code });
    return { available: false, changes: null };
  }
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r) return { available: true, changes: null };
  return {
    available: true,
    changes: {
      anomalies_opened: num(r.anomalies_opened),
      anomalies_closed: num(r.anomalies_closed),
      newly_missing: num(r.newly_missing),
      recovered: num(r.recovered),
      checks_total: num(r.checks_total),
      checks_unverifiable: num(r.checks_unverifiable),
    },
  };
}

export type AnomalyListRow = {
  id: string;
  property_id: string;
  portal_listing_id: string | null;
  type: string;
  severity: string;
  status: string;
  risk_score: number | null;
  details: Record<string, unknown>;
  first_seen_at: string;
  sla_stage: number;
  sla_due_at: string | null;
  explained_reason_code: string | null;
  advisor_id: string | null;
};

/** Anomali kuyruğu (RLS kapsamlı, sunucu filtre + gerçek sayfalama: URL searchParams'a bağlanır). */
export async function listAnomalies(
  db: Db,
  opts: { statuses?: string[]; type?: string | null; propertyId?: string | null; advisorId?: string | null; page?: number; pageSize?: number } = {},
): Promise<{ available: boolean; rows: AnomalyListRow[]; total: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  let q = db
    .from("listing_anomalies")
    .select("id, property_id, portal_listing_id, type, severity, status, risk_score, details, first_seen_at, sla_stage, sla_due_at, explained_reason_code, advisor_id", { count: "exact" })
    .order("risk_score", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  q = q.in("status", opts.statuses?.length ? opts.statuses : ["open", "acknowledged", "explained"]);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.propertyId) q = q.eq("property_id", opts.propertyId);
  if (opts.advisorId) q = q.eq("advisor_id", opts.advisorId);
  const { data, error, count } = await q;
  if (error) {
    if (!isMissingSchema(error)) console.error("listAnomalies", { code: error.code });
    return { available: false, rows: [], total: 0 };
  }
  return { available: true, rows: (data ?? []) as AnomalyListRow[], total: count ?? 0 };
}

/** Portföy detayı "Portal geçmişi": ilan no zinciri, tarih aralıkları, toplam yayın süresi. */
export async function getPropertyPortalHistory(db: Db, propertyId: string, nowMs: number): Promise<ChainStats[]> {
  const { data, error } = await db
    .from("portal_listings")
    .select("id, portal_name, portal_listing_id, status, published_at, removed_at, supersedes_id")
    .eq("property_id", propertyId)
    .order("published_at", { ascending: true });
  if (error) {
    // supersedes_id yoksa (migration uygulanmamış) eski kolonlarla zincirsiz döner.
    if (isMissingSchema(error)) {
      const { data: legacy } = await db
        .from("portal_listings")
        .select("id, portal_name, portal_listing_id, status, published_at, removed_at")
        .eq("property_id", propertyId)
        .order("published_at", { ascending: true });
      return buildChainStats(
        ((legacy ?? []) as Record<string, string | null>[]).map((r) => ({
          id: String(r.id), portal: String(r.portal_name), externalId: r.portal_listing_id, status: String(r.status),
          publishedAt: r.published_at, removedAt: r.removed_at, supersedesId: null,
        })),
        nowMs,
      );
    }
    console.error("getPropertyPortalHistory", { code: error.code });
    return [];
  }
  return buildChainStats(
    ((data ?? []) as Record<string, string | null>[]).map((r) => ({
      id: String(r.id), portal: String(r.portal_name), externalId: r.portal_listing_id, status: String(r.status),
      publishedAt: r.published_at, removedAt: r.removed_at, supersedesId: r.supersedes_id,
    })),
    nowMs,
  );
}

export type TodayCheckRow = { portal_listing_id: string; property_id: string; check_state: string; next_check_at: string | null; last_check_at: string | null; portal_price: number | null };

/** Danışmanın "Bugün teyit edilecekler" listesi (RLS: yalnız görebildiği ilanlar). */
export async function listTodayChecks(db: Db, nowIso: string, limit = 50): Promise<{ available: boolean; rows: TodayCheckRow[] }> {
  const { data, error } = await db
    .from("portal_listing_health")
    .select("portal_listing_id, property_id, check_state, next_check_at, last_check_at, portal_price")
    .neq("check_state", "paused")
    .lte("next_check_at", nowIso)
    .order("next_check_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    if (!isMissingSchema(error)) console.error("listTodayChecks", { code: error.code });
    return { available: false, rows: [] };
  }
  return { available: true, rows: (data ?? []) as TodayCheckRow[] };
}
