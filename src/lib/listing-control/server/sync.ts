import { evaluateProperty, type EvaluationExtras } from "../engine";
import type { ListingControlConfig } from "../config";
import type { ListingSnapshot, PropertySnapshot } from "../anomaly-rules";
import { deriveLifecycle } from "../lifecycle";
import { PROPERTY_MANAGED_ANOMALY_TYPES, type CheckState } from "../types";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * Portföy kontrol SENKRONU (sunucu): anlık görüntüyü topla → saf motor (`engine.ts`) → `lc_sync_anomalies` (anomali
 * aç/yeniden aç/otomatik kapat) + `lc_upsert_control_states` (aşama, skor, KPI bayrakları). Yeniden çalıştırmak
 * güvenlidir (idempotent): aynı durum aynı anomaliyi iki kez açmaz (dedupe_key), kapanan koşul `auto_closed` olur.
 * Veri okuma hataları o portföyü ATLAR (yanlış anomali/yanlış kapanış üretmemek için); şema yoksa sessizce 0 döner.
 * Ölçülemeyen girdiler (fotoğraf skoru, EİDS belge bilgisi) null geçilir: sağlık skoru "kısmi" olur, kullanıcı
 * cezalandırılmaz.
 */

export type SyncSummary = {
  examined: number;
  skipped: number;
  anomaliesOpened: number;
  anomaliesReopened: number;
  anomaliesClosed: number;
  statesWritten: number;
  schemaMissing: boolean;
};

const EMPTY: SyncSummary = {
  examined: 0,
  skipped: 0,
  anomaliesOpened: 0,
  anomaliesReopened: 0,
  anomaliesClosed: 0,
  statesWritten: 0,
  schemaMissing: false,
};

type PropRow = {
  id: string;
  property_code: string | null;
  status: string | null;
  deleted_at: string | null;
  list_price: number | null;
  assigned_to: string | null;
  authorization_end: string | null;
  updated_at: string | null;
};
type ListingRow = { id: string; property_id: string; portal_name: string; portal_listing_id: string | null; portal_url: string | null; published_at: string | null };
type HealthRow = {
  portal_listing_id: string;
  check_state: CheckState;
  confidence: number | null;
  portal_price: number | null;
  portal_advisor_name: string | null;
  first_absent_at: string | null;
  last_success_at: string | null;
  last_seen_at: string | null;
};
type AnomalyRow = { property_id: string; dedupe_key: string; type: string; status: string; first_seen_at: string; assigned_at?: string | null };

const HOUR = 3_600_000;
const DAY = 86_400_000;

async function rows<T>(q: PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>): Promise<{ data: T[]; missing: boolean; failed: boolean }> {
  const { data, error } = await q;
  if (error) return { data: [], missing: isMissingSchema(error), failed: true };
  return { data: (data ?? []) as T[], missing: false, failed: false };
}

/** Bir ofisin verilen portföylerini değerlendirir ve yazar. `ids` en fazla 100'lük parçalara bölünür. */
export async function syncProperties(db: Db, tenantId: string, ids: readonly string[], cfg: ListingControlConfig, nowMs: number): Promise<SyncSummary> {
  const summary: SyncSummary = { ...EMPTY };
  for (const part of chunk([...new Set(ids)], 100)) {
    const r = await syncChunk(db, tenantId, part, cfg, nowMs);
    summary.examined += r.examined;
    summary.skipped += r.skipped;
    summary.anomaliesOpened += r.anomaliesOpened;
    summary.anomaliesReopened += r.anomaliesReopened;
    summary.anomaliesClosed += r.anomaliesClosed;
    summary.statesWritten += r.statesWritten;
    summary.schemaMissing = summary.schemaMissing || r.schemaMissing;
    if (r.schemaMissing) break;
  }
  return summary;
}

async function syncChunk(db: Db, tenantId: string, ids: string[], cfg: ListingControlConfig, nowMs: number): Promise<SyncSummary> {
  const out: SyncSummary = { ...EMPTY };
  if (ids.length === 0) return out;

  const props = await rows<PropRow>(
    db
      .from("properties")
      .select("id, property_code, status, deleted_at, list_price, assigned_to, authorization_end, updated_at")
      .eq("tenant_id", tenantId)
      .in("id", ids),
  );
  if (props.failed) return { ...out, skipped: ids.length, schemaMissing: props.missing };

  const [listingsQ, poolQ, dealsQ, anomaliesQ, ownerQ, prevQ] = await Promise.all([
    rows<ListingRow>(
      db
        .from("portal_listings")
        .select("id, property_id, portal_name, portal_listing_id, portal_url, published_at")
        .eq("tenant_id", tenantId)
        .eq("status", "live")
        .in("property_id", ids),
    ),
    rows<{ property_id: string }>(db.from("listing_pool_entries").select("property_id").eq("tenant_id", tenantId).eq("status", "pending").in("property_id", ids)),
    rows<{ property_id: string; stage: string }>(db.from("deals").select("property_id, stage").eq("tenant_id", tenantId).in("property_id", ids)),
    rows<AnomalyRow>(
      db
        .from("listing_anomalies")
        .select("property_id, dedupe_key, type, status, first_seen_at")
        .eq("tenant_id", tenantId)
        .in("property_id", ids)
        .in("status", ["open", "acknowledged", "explained"]),
    ),
    rows<{ property_id: string }>(db.from("property_owner_info").select("property_id").eq("tenant_id", tenantId).in("property_id", ids)),
    rows<{ property_id: string; assigned_at: string | null; advisor_id: string | null }>(
      db.from("property_control_state").select("property_id, assigned_at, advisor_id").eq("tenant_id", tenantId).in("property_id", ids),
    ),
  ]);
  if (prevQ.missing) return { ...out, skipped: ids.length, schemaMissing: true };
  const prevState = new Map(prevQ.data.map((r) => [r.property_id, r]));
  const nowIso = new Date(nowMs).toISOString();
  // Kontrol tabloları yoksa (migration uygulanmamış) hiçbir şey yazılmaz.
  if (anomaliesQ.missing) return { ...out, skipped: ids.length, schemaMissing: true };
  if (listingsQ.failed || dealsQ.failed || anomaliesQ.failed) return { ...out, skipped: ids.length };

  const listings = listingsQ.data;
  const healthQ = listings.length
    ? await rows<HealthRow>(
        db
          .from("portal_listing_health")
          .select("portal_listing_id, check_state, confidence, portal_price, portal_advisor_name, first_absent_at, last_success_at, last_seen_at")
          .eq("tenant_id", tenantId)
          .in("portal_listing_id", listings.map((l) => l.id)),
      )
    : { data: [] as HealthRow[], missing: false, failed: false };
  if (healthQ.missing) return { ...out, skipped: ids.length, schemaMissing: true };
  const health = new Map(healthQ.data.map((h) => [h.portal_listing_id, h]));

  const assigneeIds = [...new Set(props.data.map((p) => p.assigned_to).filter((x): x is string => !!x))];
  type ProfileRow = { id: string; full_name: string | null; is_active: boolean | null };
  const profiles = assigneeIds.length
    ? await rows<ProfileRow>(db.from("profiles").select("id, full_name, is_active").eq("tenant_id", tenantId).in("id", assigneeIds))
    : { data: [] as ProfileRow[], missing: false, failed: false };
  const profileById = new Map(profiles.data.map((p) => [p.id, p]));

  const poolPending = new Set(poolQ.data.map((r) => r.property_id));
  const ownerInfo = ownerQ.failed ? null : new Set(ownerQ.data.map((r) => r.property_id));
  const dealsByProp = new Map<string, string[]>();
  for (const d of dealsQ.data) dealsByProp.set(d.property_id, [...(dealsByProp.get(d.property_id) ?? []), d.stage]);
  const anomaliesByProp = new Map<string, AnomalyRow[]>();
  for (const a of anomaliesQ.data) anomaliesByProp.set(a.property_id, [...(anomaliesByProp.get(a.property_id) ?? []), a]);
  const listingsByProp = new Map<string, ListingRow[]>();
  for (const l of listings) listingsByProp.set(l.property_id, [...(listingsByProp.get(l.property_id) ?? []), l]);

  const stateRows: Record<string, unknown>[] = [];
  for (const p of props.data) {
    const stages = dealsByProp.get(p.id) ?? [];
    const snapListings: ListingSnapshot[] = (listingsByProp.get(p.id) ?? []).map((l) => {
      const h = health.get(l.id);
      return {
        id: l.id,
        portal: l.portal_name,
        externalId: l.portal_listing_id,
        url: l.portal_url,
        state: h?.check_state ?? "unchecked",
        confidence: h?.confidence ?? null,
        portalPrice: h?.portal_price ?? null,
        portalAdvisorName: h?.portal_advisor_name ?? null,
        firstAbsentAt: h?.first_absent_at ?? null,
        lastSuccessAt: h?.last_success_at ?? null,
        publishedAt: l.published_at,
      };
    });
    const hasLiveListing = snapListings.some((l) => l.state !== "probable_missing" && l.state !== "confirmed_missing");
    const life = deriveLifecycle({
      status: p.status,
      deleted: !!p.deleted_at,
      poolPending: poolPending.has(p.id),
      assignedTo: p.assigned_to,
      hasLiveListing,
      hasShowings: false,
      dealStage: stages.includes("negotiation") ? "negotiation" : null,
    });
    const existing = anomaliesByProp.get(p.id) ?? [];
    const explainedKeys = existing.filter((a) => a.status === "explained").map((a) => a.dedupe_key);
    const missingSince = existing.filter((a) => a.type === "portal_missing").map((a) => Date.parse(a.first_seen_at));
    const advisor = p.assigned_to ? profileById.get(p.assigned_to) : undefined;
    // Atama zamanı için güvenilir kaynak yok (properties.assigned_at yok): danışman değişmediyse önceki değer korunur,
    // yoksa/değiştiyse "şimdi" (sahte "yayınlanmadı" alarmı üretmez; 24/48 saat sayacı ilk değerlendirmeden başlar).
    const prev = prevState.get(p.id);
    const assignedAtIso = p.assigned_to ? (prev && prev.advisor_id === p.assigned_to && prev.assigned_at ? prev.assigned_at : nowIso) : null;
    const snapshot: PropertySnapshot = {
      propertyId: p.id,
      propertyCode: p.property_code,
      stage: life.stage,
      active: life.active,
      listings: snapListings,
      listPrice: p.list_price !== null ? Number(p.list_price) : null,
      assignedTo: p.assigned_to,
      assignedAdvisorName: advisor?.full_name ?? null,
      assignedAt: assignedAtIso,
      publishable: ["ready", "live", "active", "yayında", "yayinda", "hazır", "hazir"].includes((p.status ?? "").toLocaleLowerCase("tr-TR")),
      authorizationEnd: p.authorization_end,
      hasCrmClosure: !life.active || stages.includes("won") || stages.includes("lost"),
      closure: null,
      explainedKeys,
    };
    const extras: EvaluationExtras = {
      photoScore: null,
      daysSinceUpdate: p.updated_at ? Math.max(0, Math.floor((nowMs - Date.parse(p.updated_at)) / DAY)) : null,
      advisorActive: advisor ? advisor.is_active !== false : null,
      ownerInfoPresent: ownerInfo ? ownerInfo.has(p.id) : null,
      authorityDocPresent: null,
      hoursUnexplained: missingSince.length ? Math.max(0, (nowMs - Math.min(...missingSince)) / HOUR) : 0,
      exitKind: life.exitKind,
    };
    const ev = evaluateProperty(snapshot, extras, nowMs, cfg);

    const { data: syncRes, error: syncErr } = await db.rpc("lc_sync_anomalies", {
      p_tenant_id: tenantId,
      p_property_id: p.id,
      p_desired: ev.anomalies.map((a) => ({
        type: a.type,
        severity: a.severity,
        dedupe_key: a.dedupeKey,
        portal_listing_id: a.portalListingId,
        risk_score: ev.risk.score,
        risk_points: ev.risk.points,
        details: a.details,
        sla_due_at: a.slaDueAt,
      })),
      p_managed_types: [...PROPERTY_MANAGED_ANOMALY_TYPES],
    });
    if (syncErr) {
      if (isMissingSchema(syncErr)) return { ...out, skipped: ids.length, schemaMissing: true };
      console.error("lc_sync_anomalies", { code: syncErr.code });
      out.skipped += 1;
      continue;
    }
    const s = (syncRes ?? {}) as { opened?: number; reopened?: number; closed?: number };
    out.examined += 1;
    out.anomaliesOpened += s.opened ?? 0;
    out.anomaliesReopened += s.reopened ?? 0;
    out.anomaliesClosed += s.closed ?? 0;

    stateRows.push({
      property_id: p.id,
      lifecycle_stage: ev.stage,
      exit_kind: ev.exitKind,
      health_score: ev.health.score,
      health_color: ev.health.color,
      health_partial: ev.health.partial,
      risk_score: ev.risk.score,
      portals_live: ev.portalsLive,
      open_anomalies: ev.anomalies.filter((a) => a.severity !== "info").length,
      assigned_at: assignedAtIso,
      last_verified_at: snapListings.map((l) => l.lastSuccessAt).filter((x): x is string => !!x).sort().pop() ?? null,
      k_active: ev.kpi.active,
      k_in_portals: ev.kpi.in_portals,
      k_awaiting_publish: ev.kpi.awaiting_publish,
      k_portal_missing: ev.kpi.portal_missing,
      k_price_mismatch: ev.kpi.price_mismatch,
      k_in_review: ev.kpi.in_review,
      k_unverifiable: ev.kpi.unverifiable,
      k_healthy: ev.kpi.healthy,
    });
  }

  if (stateRows.length) {
    const { data: n, error } = await db.rpc("lc_upsert_control_states", { p_tenant_id: tenantId, p_rows: stateRows });
    if (error) {
      if (isMissingSchema(error)) return { ...out, schemaMissing: true };
      console.error("lc_upsert_control_states", { code: error.code });
    } else out.statesWritten += Number(n ?? 0);
  }
  return out;
}
