import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, trDayKey } from "@/lib/clock";
import { LIVE_PROPERTY_STATUSES } from "@/lib/team/advisor-metrics";
import {
  evaluateAlerts,
  splitByReview,
  type AlertFacts,
  type AuditFact,
  type OversightAlert,
} from "@/lib/oversight/alert-rules";
import { loadReviews, type ReviewInfo } from "@/lib/oversight/store";
import type { OversightThresholds } from "@/lib/oversight/settings";

/**
 * Ofis Kontrol Merkezi — sunucu okumalari (RLS'li kullanici istemcisi; admin client YOK).
 * Tum sorgular tenant RLS'ine dayanir; ek olarak `tenant_id` acikca suzulur.
 */

/** Uyari penceresi (gun): bundan eski olaylar uyari uretmez. */
export const ALERT_WINDOW_DAYS = 30;
const AUDIT_SCAN = 5000;
const PRICE_SCAN = 500;
const STALE_SCAN = 5000;

export type OversightAlertView = OversightAlert & { review: ReviewInfo | null };

export type AlertsLoad = {
  open: OversightAlertView[];
  reviewed: OversightAlertView[];
  /** Tarama tavanina dayandi: eski olaylar eksik olabilir. */
  partial: boolean;
  /** false: "incelendi" tablosu yok (migration uygulanmamis). */
  reviewsAvailable: boolean;
  names: Map<string, string>;
};

async function fetchNames(supabase: SupabaseClient, tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .in("id", uniq.slice(i, i + 100));
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) out.set(p.id, p.full_name);
    }
  }
  return out;
}

type AuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

/** Uyari olgularini toplar. `onlyActorId` verilirse yalniz o kisinin olaylari (danisman kendi gorunumu). */
export async function loadAlertFacts(
  supabase: SupabaseClient,
  tenantId: string,
  t: OversightThresholds,
  nowMs: number,
  onlyActorId?: string,
): Promise<{ facts: AlertFacts; partial: boolean }> {
  const since = daysAgoIso(ALERT_WINDOW_DAYS);
  const today = trDayKey(nowMs);

  let auditQ = supabase
    .from("audit_logs")
    .select("id, action, actor_id, entity_type, entity_id, created_at, old_value, new_value")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(AUDIT_SCAN);
  let priceQ = supabase
    .from("property_price_history")
    .select("id, property_id, old_price, new_price, changed_by, created_at")
    .eq("tenant_id", tenantId)
    .eq("price_field", "list_price")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(PRICE_SCAN);
  let cutQ = supabase
    .from("approval_requests")
    .select("id, requested_by, current_value, requested_value, status, created_at")
    .eq("tenant_id", tenantId)
    .eq("kind", "komisyon_indirimi")
    .gte("created_at", since)
    .limit(200);
  if (onlyActorId) {
    auditQ = auditQ.eq("actor_id", onlyActorId);
    priceQ = priceQ.eq("changed_by", onlyActorId);
    cutQ = cutQ.eq("requested_by", onlyActorId);
  }

  const certQ = supabase
    .from("advisor_profiles")
    .select("profile_id, authority_cert_expires_on")
    .eq("tenant_id", tenantId)
    .lt("authority_cert_expires_on", today)
    .limit(200);
  const liveQ = supabase
    .from("properties")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .in("status", LIVE_PROPERTY_STATUSES)
    .not("assigned_to", "is", null)
    .is("deleted_at", null)
    .limit(STALE_SCAN);
  const staleListQ = supabase
    .from("properties")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .in("status", LIVE_PROPERTY_STATUSES)
    .not("assigned_to", "is", null)
    .is("deleted_at", null)
    .lt("updated_at", daysAgoIso(t.staleListingDays))
    .limit(STALE_SCAN);
  const staleCustQ = supabase
    .from("customers")
    .select("assigned_to")
    .eq("tenant_id", tenantId)
    .not("assigned_to", "is", null)
    .is("deleted_at", null)
    .lt("updated_at", daysAgoIso(t.staleCustomerDays))
    .limit(STALE_SCAN);

  const [audit, price, cuts, certs, live, staleList, staleCust] = await Promise.all([
    auditQ,
    priceQ,
    cutQ,
    certQ,
    liveQ,
    staleListQ,
    staleCustQ,
  ]);

  const auditRows = (audit.data ?? []) as AuditRow[];
  const partial =
    auditRows.length >= AUDIT_SCAN ||
    (staleList.data?.length ?? 0) >= STALE_SCAN ||
    (staleCust.data?.length ?? 0) >= STALE_SCAN ||
    (live.data?.length ?? 0) >= STALE_SCAN;

  const count = (rows: { assigned_to: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.assigned_to) m.set(r.assigned_to, (m.get(r.assigned_to) ?? 0) + 1);
    return m;
  };
  const liveBy = count(live.data as { assigned_to: string | null }[] | null);
  const staleListBy = count(staleList.data as { assigned_to: string | null }[] | null);
  const staleCustBy = count(staleCust.data as { assigned_to: string | null }[] | null);

  const certRows = (certs.data ?? []) as { profile_id: string; authority_cert_expires_on: string | null }[];
  const staleIds = [...new Set([...staleListBy.keys(), ...staleCustBy.keys()])];
  const priceRows = (price.data ?? []) as {
    id: string;
    property_id: string;
    old_price: number | null;
    new_price: number;
    changed_by: string | null;
    created_at: string;
  }[];
  const cutRows = (cuts.data ?? []) as {
    id: string;
    requested_by: string | null;
    current_value: number | null;
    requested_value: number | null;
    status: string;
    created_at: string;
  }[];

  const names = await fetchNames(supabase, tenantId, [
    ...auditRows.map((a) => a.actor_id),
    ...priceRows.map((p) => p.changed_by),
    ...cutRows.map((c) => c.requested_by),
    ...certRows.map((c) => c.profile_id),
    ...staleIds,
  ]);

  const facts: AlertFacts = {
    audit: auditRows.map(
      (a): AuditFact => ({
        id: a.id,
        action: a.action,
        actorId: a.actor_id,
        entityType: a.entity_type,
        entityId: a.entity_id,
        createdAt: a.created_at,
        oldValue: a.old_value,
        newValue: a.new_value,
      }),
    ),
    priceChanges: priceRows.map((p) => ({
      id: p.id,
      propertyId: p.property_id,
      oldPrice: p.old_price == null ? null : Number(p.old_price),
      newPrice: Number(p.new_price),
      changedBy: p.changed_by,
      createdAt: p.created_at,
    })),
    commissionCuts: cutRows.map((c) => ({
      id: c.id,
      requestedBy: c.requested_by,
      standardRate: c.current_value == null ? null : Number(c.current_value),
      requestedRate: c.requested_value == null ? null : Number(c.requested_value),
      status: c.status,
      createdAt: c.created_at,
    })),
    certs: certRows
      .filter((c) => !onlyActorId || c.profile_id === onlyActorId)
      .map((c) => ({
        profileId: c.profile_id,
        name: names.get(c.profile_id) ?? "Danışman",
        expiresOn: c.authority_cert_expires_on,
        liveListingCount: liveBy.get(c.profile_id) ?? 0,
      })),
    stale: staleIds
      .filter((id) => !onlyActorId || id === onlyActorId)
      .map((id) => ({
        advisorId: id,
        name: names.get(id) ?? "Danışman",
        staleListings: staleListBy.get(id) ?? 0,
        staleCustomers: staleCustBy.get(id) ?? 0,
      })),
    names,
  };
  return { facts, partial };
}

/** Uyarilari hesaplar ve "incelendi" durumunu ekler. */
export async function loadAlerts(
  supabase: SupabaseClient,
  tenantId: string,
  t: OversightThresholds,
  nowMs: number,
  onlyActorId?: string,
): Promise<AlertsLoad> {
  const { facts, partial } = await loadAlertFacts(supabase, tenantId, t, nowMs, onlyActorId);
  const alerts = evaluateAlerts(facts, t, nowMs);
  const { reviews, available } = await loadReviews(
    supabase,
    tenantId,
    alerts.map((a) => a.key),
  );
  const { open, done } = splitByReview(alerts, new Set(reviews.keys()));
  const withReview = (a: OversightAlert): OversightAlertView => ({ ...a, review: reviews.get(a.key) ?? null });
  return {
    open: open.map(withReview),
    reviewed: done.map(withReview),
    partial,
    reviewsAvailable: available,
    names: new Map(facts.names),
  };
}

/** Danisman filtresi secenekleri (aktif ekip uyeleri). */
export async function loadAdvisorOptions(supabase: SupabaseClient, tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("full_name")
    .limit(200);
  return ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, name: p.full_name ?? "Adsız" }));
}

/** profiles.id -> ad (RLS'li; tenant ile sinirli). */
export const loadProfileNames = fetchNames;
