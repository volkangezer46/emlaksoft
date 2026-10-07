import { createClient } from "@/lib/supabase/server";
import { isMissingSchema, loadListingControlConfig, type Db } from "@/lib/listing-control/server/db";
import { getControlSummary, type ControlSummaryRow } from "@/lib/listing-control/server/readers";
import { computeHealthScore, type HealthResult } from "@/lib/listing-control/health-score";
import { normalizeListingControlConfig, type ListingControlConfig } from "@/lib/listing-control/config";
import { daysAgoIso } from "@/lib/clock";
import { hasValidEidsNo } from "@/lib/eids/property-no";
import { evaluateAuthorityTerm } from "@/lib/eids/authority-term";
import type { MissingEvent } from "@/lib/listing-control/advisor-patterns";
import type { ScopeKind } from "@/lib/listing-control/types";
import { ANOMALY_TYPE_LABELS, type TypeCounts } from "./helpers";
import { averageLeadHours, averageResolveHours, buildHealthInputs, buildLifecycleTimeline, type TimelineEvent } from "./lifecycle-model";

/**
 * SAYFA-YEREL okuyucular (motor `src/lib/listing-control/**` değiştirilmedi). Hepsi KULLANICI OTURUMU istemcisiyle
 * çalışır (RLS + `lc_row_visible` kapsamı); service_role YOK. Şema yoksa `available:false` döner, sahte sayı üretilmez.
 * Motorda olmayıp burada yazılanlar: tür bazlı açık anomali sayımı, grup adı çözümü, portföy özeti (kod/başlık),
 * yaşam döngüsü verisi, yayına alma süresi, çözülme süresi, doğrulanan ilan oranı.
 */

export async function getDb(): Promise<Db> {
  return (await createClient()) as unknown as Db;
}

const OPEN_STATUSES = ["open", "acknowledged"];

/** Tür bazlı AÇIK (açıklanmamış) anomali sayıları + vadesi geçen sayısı. */
export async function countOpenAnomalies(db: Db, nowIso: string): Promise<{ available: boolean; counts: TypeCounts; total: number; overdue: number }> {
  const types = Object.keys(ANOMALY_TYPE_LABELS);
  const results = await Promise.all(
    types.map((t) => db.from("listing_anomalies").select("id", { count: "exact", head: true }).eq("type", t).in("status", OPEN_STATUSES)),
  );
  const overdueRes = await db
    .from("listing_anomalies")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_STATUSES)
    .lt("sla_due_at", nowIso);
  const bad = results.find((r) => r.error);
  if (bad?.error) {
    if (!isMissingSchema(bad.error)) console.error("countOpenAnomalies", { code: bad.error.code });
    return { available: false, counts: {}, total: 0, overdue: 0 };
  }
  const counts: TypeCounts = {};
  let total = 0;
  types.forEach((t, i) => {
    const n = results[i]?.count ?? 0;
    counts[t] = n;
    total += n;
  });
  return { available: true, counts, total, overdue: overdueRes.error ? 0 : (overdueRes.count ?? 0) };
}

/** Grup kimliklerini görünen ada çevirir (danışman = profil adı, şube = şube adı; takım tablosu yok: kısa kod). */
export async function resolveGroupNames(db: Db, scope: ScopeKind, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  if (scope === "advisor") {
    const { data } = await db.from("profiles").select("id, full_name").in("id", uniq);
    for (const r of (data ?? []) as { id: string; full_name: string | null }[]) out.set(r.id, r.full_name?.trim() || "İsimsiz danışman");
  } else if (scope === "branch") {
    const { data } = await db.from("branches").select("id, name").in("id", uniq);
    for (const r of (data ?? []) as { id: string; name: string | null }[]) out.set(r.id, r.name?.trim() || "Şube");
  } else if (scope === "team") {
    uniq.forEach((id, i) => out.set(id, `Takım ${i + 1} (${id.slice(0, 4)})`));
  }
  return out;
}

export type PropertyBrief = { id: string; code: string; title: string; price: number | null; advisorId: string | null; commissionRate: number | null };

export async function loadPropertyBriefs(db: Db, ids: readonly string[]): Promise<Map<string, PropertyBrief>> {
  const out = new Map<string, PropertyBrief>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const { data } = await db.from("properties").select("id, property_code, title, list_price, assigned_to, commission_rate").in("id", uniq);
  for (const r of (data ?? []) as { id: string; property_code: string; title: string | null; list_price: number | null; assigned_to: string | null; commission_rate: number | null }[]) {
    out.set(r.id, { id: r.id, code: r.property_code, title: r.title?.trim() || "İsimsiz portföy", price: r.list_price === null ? null : Number(r.list_price), advisorId: r.assigned_to, commissionRate: r.commission_rate === null || r.commission_rate === undefined ? null : Number(r.commission_rate) });
  }
  return out;
}

export async function loadProfileNames(db: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  return resolveGroupNames(db, "advisor", ids);
}

// ---------------------------------------------------------------- rapor / kart verileri

export type LeadTimeStats = { available: boolean; overallHours: number | null; byAdvisor: Map<string, number | null> };

/** Atama -> ilk portal yayını süresi (son 90 günde atanan portföyler; en çok 1000 kayıt). */
export async function loadPublishLeadTimes(db: Db, sinceIso: string): Promise<LeadTimeStats> {
  const { data: states, error } = await db
    .from("property_control_state")
    .select("property_id, advisor_id, assigned_at")
    .not("assigned_at", "is", null)
    .gte("assigned_at", sinceIso)
    .limit(1000);
  if (error) {
    if (!isMissingSchema(error)) console.error("loadPublishLeadTimes", { code: error.code });
    return { available: false, overallHours: null, byAdvisor: new Map() };
  }
  const rows = (states ?? []) as { property_id: string; advisor_id: string | null; assigned_at: string }[];
  if (rows.length === 0) return { available: true, overallHours: null, byAdvisor: new Map() };
  const ids = rows.map((r) => r.property_id);
  const first = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("portal_listings").select("property_id, published_at").in("property_id", ids.slice(i, i + 200)).not("published_at", "is", null);
    for (const l of (data ?? []) as { property_id: string; published_at: string }[]) {
      const cur = first.get(l.property_id);
      if (!cur || Date.parse(l.published_at) < Date.parse(cur)) first.set(l.property_id, l.published_at);
    }
  }
  const pairs = rows.map((r) => ({ advisor: r.advisor_id, assignedAt: r.assigned_at, firstPublishedAt: first.get(r.property_id) ?? null }));
  const byAdvisor = new Map<string, number | null>();
  for (const adv of new Set(pairs.map((p) => p.advisor).filter((a): a is string => !!a))) {
    byAdvisor.set(adv, averageLeadHours(pairs.filter((p) => p.advisor === adv)));
  }
  return { available: true, overallHours: averageLeadHours(pairs), byAdvisor };
}

export async function loadResolveStats(db: Db, sinceIso: string): Promise<{ available: boolean; avgHours: number | null; resolved: number }> {
  const { data, error } = await db
    .from("listing_anomalies")
    .select("first_seen_at, resolved_at")
    .in("status", ["resolved", "auto_closed"])
    .gte("resolved_at", sinceIso)
    .limit(1000);
  if (error) {
    if (!isMissingSchema(error)) console.error("loadResolveStats", { code: error.code });
    return { available: false, avgHours: null, resolved: 0 };
  }
  const rows = ((data ?? []) as { first_seen_at: string; resolved_at: string | null }[]).map((r) => ({ firstSeenAt: r.first_seen_at, resolvedAt: r.resolved_at }));
  return { available: true, avgHours: averageResolveHours(rows), resolved: rows.length };
}

/** Doğrulanan ilan oranı (portal uygunluk): doğrulanmış / duraklatılmamış tüm kontrol kayıtları. */
export async function loadVerifiedRatio(db: Db): Promise<{ available: boolean; verified: number; total: number; percent: number | null }> {
  const [all, ok] = await Promise.all([
    db.from("portal_listing_health").select("portal_listing_id", { count: "exact", head: true }).neq("check_state", "paused"),
    db.from("portal_listing_health").select("portal_listing_id", { count: "exact", head: true }).eq("check_state", "verified"),
  ]);
  if (all.error || ok.error) {
    const err = all.error ?? ok.error;
    if (err && !isMissingSchema(err)) console.error("loadVerifiedRatio", { code: err.code });
    return { available: false, verified: 0, total: 0, percent: null };
  }
  const total = all.count ?? 0;
  const verified = ok.count ?? 0;
  return { available: true, verified, total, percent: total > 0 ? Math.round((verified / total) * 100) : null };
}

export async function loadAdvisorOpsRow(db: Db, advisorId: string): Promise<{ available: boolean; row: ControlSummaryRow | null; awaitingExplanation: number; leadHours: number | null }> {
  const res = await getControlSummary(db, "advisor");
  if (!res.available) return { available: false, row: null, awaitingExplanation: 0, leadHours: null };
  const row = res.rows.find((r) => r.group_id === advisorId) ?? null;
  const [{ count }, publishStats] = await Promise.all([
    db.from("listing_anomalies").select("id", { count: "exact", head: true }).eq("advisor_id", advisorId).eq("status", "open"),
    loadPublishLeadTimes(db, daysAgoIso(90)),
  ]);
  return { available: true, row, awaitingExplanation: count ?? 0, leadHours: publishStats.byAdvisor.get(advisorId) ?? null };
}

// ---------------------------------------------------------------- portföy yaşam döngüsü

export type PortalHealthRow = {
  portal_listing_id: string;
  check_state: string;
  confidence: number | null;
  last_check_at: string | null;
  last_success_at: string | null;
  last_seen_at: string | null;
  last_check_result: string | null;
  portal_price: number | null;
};

export type LifecycleData = {
  available: boolean;
  /** Kontrol tabloları (sağlık/anomali/durum) okunabildi mi; false ise yalnız portal ilan zinciri vardır. */
  controlAvailable: boolean;
  listings: { id: string; portal: string; externalId: string | null; url: string | null; status: string; publishedAt: string | null; removedAt: string | null; supersedesId: string | null }[];
  health: Map<string, PortalHealthRow>;
  score: HealthResult | null;
  storedScore: number | null;
  stage: string | null;
  exitKind: string | null;
  listPrice: number | null;
  openAnomalies: { id: string; type: string; status: string; riskScore: number | null }[];
  config: ListingControlConfig | null;
};

/** Portföy detayı verisi: portal ilanları + sağlık satırları + sağlık skoru bileşenleri (olaylar: `loadLifecycleEvents`). */
export async function loadLifecycle(db: Db, tenantId: string | null, propertyId: string, nowMs: number): Promise<LifecycleData> {
  const empty: LifecycleData = { available: false, controlAvailable: false, listings: [], health: new Map(), score: null, storedScore: null, stage: null, exitKind: null, listPrice: null, openAnomalies: [], config: null };
  const [prop, listings, health, anomalies, state] = await Promise.all([
    db.from("properties").select("created_at, updated_at, list_price, assigned_to, authorization_start, authorization_end").eq("id", propertyId).maybeSingle(),
    db.from("portal_listings").select("id, portal_name, portal_listing_id, portal_url, status, published_at, removed_at, supersedes_id").eq("property_id", propertyId).order("published_at", { ascending: true }),
    db.from("portal_listing_health").select("portal_listing_id, check_state, confidence, last_check_at, last_success_at, last_seen_at, last_check_result, portal_price").eq("property_id", propertyId),
    db.from("listing_anomalies").select("id, type, status, risk_score").eq("property_id", propertyId).order("first_seen_at", { ascending: false }).limit(40),
    db.from("property_control_state").select("health_score, lifecycle_stage, exit_kind").eq("property_id", propertyId).maybeSingle(),
  ]);
  // Portal ilanları okunamıyorsa (yetki/şema) ekran dürüstçe "etkin değil" der; diğerleri eksik olabilir (en iyi çaba).
  if (listings.error || prop.error) {
    if (listings.error && !isMissingSchema(listings.error)) console.error("loadLifecycle", { code: listings.error.code });
    return empty;
  }
  const schemaOk = !health.error && !state.error && !anomalies.error;
  const p = (prop.data ?? null) as { created_at: string | null; updated_at: string | null; list_price: number | null; assigned_to: string | null; authorization_start: string | null; authorization_end: string | null } | null;
  const ls = ((listings.data ?? []) as Record<string, string | null>[]).map((r) => ({
    id: String(r.id), portal: String(r.portal_name), externalId: r.portal_listing_id, url: r.portal_url, status: String(r.status),
    publishedAt: r.published_at, removedAt: r.removed_at, supersedesId: r.supersedes_id ?? null,
  }));
  const healthMap = new Map<string, PortalHealthRow>();
  for (const h of (health.data ?? []) as PortalHealthRow[]) healthMap.set(h.portal_listing_id, { ...h, portal_price: h.portal_price === null ? null : Number(h.portal_price) });
  const st = (state.data ?? null) as { health_score: number | null; lifecycle_stage: string; exit_kind: string | null } | null;
  const anRows = (anomalies.data ?? []) as { id: string; type: string; status: string; risk_score: number | null }[];

  const config = tenantId ? await loadListingControlConfig(db, tenantId) : normalizeListingControlConfig(null);
  // EİDS taşınmaz no ayrı, hataya dayanıklı okunur (sütun yoksa ölçülemedi).
  const eidsRes = await db.from("properties").select("eids_property_no").eq("id", propertyId).maybeSingle();
  const eidsPresent = eidsRes.error ? null : hasValidEidsNo((eidsRes.data as { eids_property_no?: string | null } | null)?.eids_property_no);
  const inputs = buildHealthInputs(
    {
      hasAdvisor: !!p?.assigned_to,
      listPrice: p?.list_price === null || p?.list_price === undefined ? null : Number(p.list_price),
      updatedAt: p?.updated_at ?? null,
      authorizationEnd: p?.authorization_end ?? null,
      eidsNoPresent: eidsPresent,
      authorityShort: p ? evaluateAuthorityTerm({ start: p.authorization_start, end: p.authorization_end }, nowMs).short : false,
      listings: ls.map((l) => {
        const h = healthMap.get(l.id);
        return { live: l.status === "live" && !["probable_missing", "confirmed_missing"].includes(h?.check_state ?? ""), verified: h?.check_state === "verified", externalId: l.externalId, url: l.url, portalPrice: h?.portal_price ?? null, lastSuccessAt: h?.last_success_at ?? null };
      }),
    },
    nowMs,
    config,
  );
  return {
    available: true,
    controlAvailable: schemaOk,
    listings: ls,
    health: healthMap,
    score: computeHealthScore(inputs, config.healthWeights, config.healthColors),
    storedScore: st?.health_score ?? null,
    stage: st?.lifecycle_stage ?? null,
    exitKind: st?.exit_kind ?? null,
    listPrice: p?.list_price === null || p?.list_price === undefined ? null : Number(p.list_price),
    openAnomalies: anRows.filter((a) => OPEN_STATUSES.includes(a.status) || a.status === "explained").map((a) => ({ id: a.id, type: a.type, status: a.status, riskScore: a.risk_score })),
    config,
  };
}

/** Son dönemde açılan portal kaybı uyarıları (danışman örüntüsü için). RLS rol kapsamlı; en çok 1000 satır. */

/**
 * Portföyün İLAN KONTROL olayları (aşama geçişi, danışmana atama, portal yayın/kaldırma [neden + kim], ilan no değişimi,
 * portal teyidi/kayboluş, uyarı/açıklama/çözüm). Portföy "Zaman çizelgesi" sekmesi (TEK tünel) bunları CRM olaylarıyla
 * birleştirir; fiyat ve oluşturma CRM tarafında olduğundan burada üretilmez (mükerrer yok). Tablolar yoksa boş döner.
 */
export async function loadLifecycleEvents(db: Db, propertyId: string): Promise<{ available: boolean; events: TimelineEvent[] }> {
  const [listings, verifs, anomalies, state] = await Promise.all([
    db.from("portal_listings").select("id, portal_name, portal_listing_id, portal_url, status, published_at, removed_at, supersedes_id").eq("property_id", propertyId).order("published_at", { ascending: true }),
    db.from("listing_verifications").select("checked_at, result, state_after, portal_listing_id").eq("property_id", propertyId).order("checked_at", { ascending: false }).limit(40),
    db.from("listing_anomalies").select("type, first_seen_at, explained_at, explained_reason_code, resolved_at").eq("property_id", propertyId).order("first_seen_at", { ascending: false }).limit(40),
    db.from("property_control_state").select("lifecycle_stage, stage_since, assigned_at").eq("property_id", propertyId).maybeSingle(),
  ]);
  if (listings.error) {
    if (!isMissingSchema(listings.error)) console.error("loadLifecycleEvents", { code: listings.error.code });
    return { available: false, events: [] };
  }
  const ls = ((listings.data ?? []) as Record<string, string | null>[]).map((r) => ({
    id: String(r.id), portal: String(r.portal_name), externalId: r.portal_listing_id, url: r.portal_url, status: String(r.status),
    publishedAt: r.published_at, removedAt: r.removed_at, supersedesId: r.supersedes_id ?? null,
  }));
  const portalById = new Map(ls.map((l) => [l.id, l.portal]));
  const st = state.error ? null : ((state.data ?? null) as { lifecycle_stage: string; stage_since: string | null; assigned_at: string | null } | null);
  const [stageRes, closureRes, extraRes] = await Promise.all([
    db.from("lc_lifecycle_events").select("created_at, from_stage, to_stage, actor_id, actor_source, reason").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(40),
    ls.length
      ? db.from("listing_closures").select("portal_listing_id, reason, created_by, created_at").in("portal_listing_id", ls.map((l) => l.id)).order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [], error: null }),
    ls.length
      ? db.from("portal_listings").select("id, ended_reason, removal_reason, published_by").in("id", ls.map((l) => l.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const stageRows = stageRes.error ? [] : ((stageRes.data ?? []) as { created_at: string; from_stage: string | null; to_stage: string; actor_id: string | null; actor_source: "user" | "inferred" | "system"; reason: string | null }[]);
  const closureRows = closureRes.error ? [] : ((closureRes.data ?? []) as { portal_listing_id: string; reason: string | null; created_by: string | null; created_at: string }[]);
  const extraRows = extraRes.error ? [] : ((extraRes.data ?? []) as { id: string; ended_reason: string | null; removal_reason: string | null; published_by: string | null }[]);
  const closureByListing = new Map<string, { reason: string | null; created_by: string | null }>();
  for (const c of closureRows) if (!closureByListing.has(c.portal_listing_id)) closureByListing.set(c.portal_listing_id, c);
  const extraById = new Map(extraRows.map((r) => [r.id, r]));
  const actorNames = await loadProfileNames(db, [...stageRows.map((x) => x.actor_id), ...closureRows.map((c) => c.created_by), ...extraRows.map((r) => r.published_by)]);
  const anRows = anomalies.error ? [] : ((anomalies.data ?? []) as { type: string; first_seen_at: string; explained_at: string | null; explained_reason_code: string | null; resolved_at: string | null }[]);
  const events = buildLifecycleTimeline({
    createdAt: null,
    assignedAt: st?.assigned_at ?? null,
    stage: st ? { stage: st.lifecycle_stage, since: st.stage_since } : null,
    stageEvents: stageRows.map((x) => ({
      at: x.created_at,
      from: x.from_stage,
      to: x.to_stage,
      actorName: x.actor_id ? (actorNames.get(x.actor_id) ?? null) : null,
      actorSource: x.actor_source,
      reason: x.reason,
    })),
    listings: ls.map((l) => {
      const x = extraById.get(l.id);
      const c = closureByListing.get(l.id);
      return {
        ...l,
        endedReason: x?.ended_reason ?? null,
        removalReason: c?.reason ?? x?.removal_reason ?? null,
        removedByName: c?.created_by ? (actorNames.get(c.created_by) ?? null) : null,
        publishedByName: x?.published_by ? (actorNames.get(x.published_by) ?? null) : null,
      };
    }),
    verifications: verifs.error
      ? []
      : ((verifs.data ?? []) as { checked_at: string; result: string; state_after: string | null; portal_listing_id: string }[]).map((v) => ({
          checkedAt: v.checked_at, portal: portalById.get(v.portal_listing_id) ?? "Portal", result: v.result, stateAfter: v.state_after,
        })),
    prices: [],
    anomalies: anRows.map((a) => ({ type: a.type, firstSeenAt: a.first_seen_at, explainedAt: a.explained_at, explainedReason: a.explained_reason_code, resolvedAt: a.resolved_at })),
  });
  return { available: true, events };
}

export async function loadMissingEvents(db: Db, sinceIso: string): Promise<{ available: boolean; events: MissingEvent[] }> {
  const { data, error } = await db
    .from("listing_anomalies")
    .select("advisor_id, property_id, first_seen_at")
    .eq("type", "portal_missing")
    .gte("first_seen_at", sinceIso)
    .order("first_seen_at", { ascending: false })
    .limit(1000);
  if (error) {
    if (!isMissingSchema(error)) console.error("loadMissingEvents", { code: error.code });
    return { available: false, events: [] };
  }
  const events = ((data ?? []) as { advisor_id: string | null; property_id: string; first_seen_at: string }[]).map((r) => ({
    advisorId: r.advisor_id,
    propertyId: r.property_id,
    atMs: Date.parse(r.first_seen_at),
  }));
  return { available: true, events };
}
