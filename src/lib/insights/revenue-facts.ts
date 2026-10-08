import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { now, trDayKey } from "@/lib/clock";
import { InsightFactsUnavailable, isMissingSchemaError, loadStaleListings } from "@/lib/insights/facts";
import {
  AUTHORITY_RENEWAL_MAX_DAYS,
  AUTHORITY_RENEWAL_MIN_DAYS,
  PRICE_REVISION_MIN_DAYS,
  UNSHOWN_MATCH_MIN_SCORE,
  type AuthorityRenewalFact,
  type HomeValueFact,
  type PriceRevisionFact,
  type ReferralInviteFact,
  type UnshownMatchFact,
} from "@/lib/insights/rules/revenue";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { homeValueDisplay } from "@/lib/home-value/core";

/**
 * Gelir fırsatı kurallarının olguları. `admin` engine'den gelir (bu dosya istemci OLUŞTURMAZ); HER sorgu AÇIK tenant_id
 * filtreli ve örnek veri (is_sample) dışarıda. Okuma hatası şema eksikliğiyse `InsightFactsUnavailable` fırlatılır.
 */

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const DAY = 86_400_000;
const OPEN_DEMAND = ["new", "active", "matched"];
const daysBetweenKeys = (fromKey: string, toKey: string) => Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY);
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function fail(what: string, error: { code?: string; message?: string }): never {
  if (isMissingSchemaError(error)) throw new InsightFactsUnavailable(what);
  throw new Error(`${what}: ${error.code ?? "hata"}`);
}

/* (a) yetki belgesi 16-30 gün */
export async function loadAuthorityRenewals(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<AuthorityRenewalFact[]> {
  const today = trDayKey(nowMs);
  const { data, error } = await fetchAllRowsKeepError<
    { id: string; title: string | null; property_code: string | null; assigned_to: string | null; authorization_end: string; list_price: number | string | null; commission_rate: number | string | null },
    { message: string; code?: string }
  >((from, to) =>
    admin
      .from("properties")
      .select("id, title, property_code, assigned_to, authorization_end, list_price, commission_rate")
      .eq("tenant_id", tenantId)
      .eq("status", "live")
      .eq("is_sample", false)
      .is("deleted_at", null)
      .not("assigned_to", "is", null)
      .gte("authorization_end", addDays(today, AUTHORITY_RENEWAL_MIN_DAYS))
      .lte("authorization_end", addDays(today, AUTHORITY_RENEWAL_MAX_DAYS))
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) fail("properties(authority_renewal)", error);
  const numOrNull = (v: number | string | null) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return data.map((p) => ({
    propertyId: p.id,
    assignedTo: String(p.assigned_to),
    label: p.title ?? p.property_code,
    endDate: String(p.authorization_end).slice(0, 10),
    daysLeft: daysBetweenKeys(today, String(p.authorization_end).slice(0, 10)),
    listPrice: numOrNull(p.list_price),
    commissionRate: numOrNull(p.commission_rate),
  }));
}

/* (b) güçlü eşleşme, gösterim yok */
type DemandRow = MatchDemand & {
  customer_id: string;
  created_at: string;
  customer: Rel<{ full_name: string | null; assigned_to: string | null; is_sample?: boolean | null; deleted_at?: string | null }>;
};
type PropRow = Omit<MatchProperty, "list_price"> & { list_price: number | string | null; assigned_to: string | null; created_at: string; published_at: string | null };

const MAX_DEMANDS = 200;
const MAX_PROPERTIES = 1000;
/** Eşleşme taraması CPU bütçesi (ms): aşılırsa o ana kadar bulunanlarla devam edilir. */
const MATCH_SCAN_BUDGET_MS = 8_000;
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export async function loadUnshownMatches(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<UnshownMatchFact[]> {
  const [demandRes, propRes, weights] = await Promise.all([
    admin
      .from("customer_demands")
      .select(
        "id, customer_id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, created_at, customer:customers!customer_demands_customer_id_fkey(full_name, assigned_to, is_sample, deleted_at)",
      )
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .in("status", OPEN_DEMAND)
      .order("created_at", { ascending: false })
      .limit(MAX_DEMANDS),
    admin
      .from("properties")
      .select("id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, neighborhood_id, features, assigned_to, created_at, published_at")
      .eq("tenant_id", tenantId)
      .eq("is_sample", false)
      .eq("status", "live")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(MAX_PROPERTIES),
    fetchTenantMatchingWeights(admin, tenantId),
  ]);
  if (demandRes.error) fail("customer_demands(unshown_match)", demandRes.error);
  if (propRes.error) fail("properties(unshown_match)", propRes.error);
  const demands = (demandRes.data ?? []) as unknown as DemandRow[];
  const props = (propRes.data ?? []) as unknown as PropRow[];
  if (demands.length === 0 || props.length === 0) return [];

  type Pair = { d: DemandRow; p: PropRow; score: number };
  const pairs: Pair[] = [];
  const scanStart = now();
  for (const d of demands) {
    if (now() - scanStart > MATCH_SCAN_BUDGET_MS) break;
    const customer = one(d.customer);
    if (!customer || customer.is_sample || customer.deleted_at) continue;
    let best: Pair | null = null;
    for (const p of props) {
      // Ucuz ön eleme: işlem tipi ve (talepte varsa) mülk tipi zorunlu eşleşir; puanlama yalnız adaylara.
      if (!sameText(d.transaction_type, p.transaction_type)) continue;
      if (d.property_type && !sameText(d.property_type, p.property_type)) continue;
      const result = scoreDemandProperty(
        { ...d, budget_min: d.budget_min != null ? Number(d.budget_min) : null, budget_max: d.budget_max != null ? Number(d.budget_max) : null, min_sqm: d.min_sqm != null ? Number(d.min_sqm) : null },
        { ...p, list_price: p.list_price != null ? Number(p.list_price) : null },
        weights,
      );
      if (result.eliminated || result.score < UNSHOWN_MATCH_MIN_SCORE) continue;
      if (!best || result.score > best.score) best = { d, p, score: result.score };
    }
    if (best) pairs.push(best);
  }
  if (pairs.length === 0) return [];

  // Müşteri × portföy randevusu (iptal hariç) var mı?
  const customerIds = [...new Set(pairs.map((x) => x.d.customer_id))];
  const booked = new Set<string>();
  for (let i = 0; i < customerIds.length; i += 200) {
    const part = customerIds.slice(i, i + 200);
    const res = await fetchAllRowsKeepError<{ customer_id: string | null; property_id: string | null }, { message: string; code?: string }>((from, to) =>
      admin
        .from("appointments")
        .select("id, customer_id, property_id")
        .eq("tenant_id", tenantId)
        .in("customer_id", part)
        .neq("status", "cancelled")
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (res.error) fail("appointments(unshown_match)", res.error);
    for (const a of res.data) if (a.customer_id && a.property_id) booked.add(`${a.customer_id}|${a.property_id}`);
  }

  const out: UnshownMatchFact[] = [];
  for (const { d, p, score } of pairs) {
    const customer = one(d.customer);
    const assignedTo = customer?.assigned_to ?? p.assigned_to;
    if (!assignedTo) continue;
    const born = Math.max(Date.parse(d.created_at), Date.parse(p.published_at ?? p.created_at));
    out.push({
      demandId: d.id,
      propertyId: p.id,
      customerName: customer?.full_name ?? null,
      propertyLabel: p.title ?? p.property_code,
      assignedTo,
      score,
      pairAgeDays: Math.max(0, Math.floor((nowMs - born) / DAY)),
      hasAppointment: booked.has(`${d.customer_id}|${p.id}`),
    });
  }
  return out;
}

/* (d) evinizin güncel değeri */
const HOME_VALUE_MAX_ESTIMATES = 12;
const HOME_VALUE_MAX_DEALS = 400;

type WonDealRow = {
  id: string;
  customer_id: string | null;
  assigned_to: string | null;
  updated_at: string;
  customer: Rel<{ full_name: string | null; assigned_to: string | null; is_sample?: boolean | null; deleted_at?: string | null }>;
  property: Rel<{ id: string; title: string | null; property_code: string | null; district_id: string | null; property_type: string | null; transaction_type: string | null; features: Record<string, unknown> | null }>;
};

export async function loadHomeValueFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<HomeValueFact[]> {
  // Ofiste örnek portföy varsa emsal motoru bozulur (home-value/load.ts ile aynı kural): üretme.
  const sample = await admin.from("properties").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_sample", true);
  if (sample.error) fail("properties(home_value_sample)", sample.error);
  if ((sample.count ?? 0) > 0) return [];

  const cutoff = new Date(nowMs - 365 * DAY).toISOString();
  const { data, error } = await admin
    .from("deals")
    .select(
      "id, customer_id, assigned_to, updated_at, customer:customers!deals_customer_id_fkey(full_name, assigned_to, is_sample, deleted_at), property:properties!deals_property_id_fkey(id, title, property_code, district_id, property_type, transaction_type, features)",
    )
    .eq("tenant_id", tenantId)
    .eq("stage", "won")
    .eq("deal_type", "sale")
    .eq("is_sample", false)
    .not("customer_id", "is", null)
    .lte("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(HOME_VALUE_MAX_DEALS);
  if (error) fail("deals(home_value)", error);
  const rows = ((data ?? []) as unknown as WonDealRow[]).filter((d) => {
    const c = one(d.customer);
    const p = one(d.property);
    return Boolean(c && !c.is_sample && !c.deleted_at && (c.assigned_to ?? d.assigned_to) && p);
  });
  if (rows.length === 0) return [];

  // Her turda sınırlı sayıda emsal sorgusu; adaylar günlük dönen pencereyle taranır (hepsi sırayla görülür).
  const offset = (Math.floor(nowMs / DAY) * HOME_VALUE_MAX_ESTIMATES) % rows.length;
  const picked = Array.from({ length: Math.min(HOME_VALUE_MAX_ESTIMATES, rows.length) }, (_, i) => rows[(offset + i) % rows.length]!);

  const { estimateFromComparables } = await import("@/lib/comparables");
  const out: HomeValueFact[] = [];
  const seenCustomer = new Set<string>();
  for (const d of picked) {
    const c = one(d.customer)!;
    const p = one(d.property)!;
    if (!d.customer_id || seenCustomer.has(d.customer_id)) continue;
    const f = p.features ?? {};
    const n = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const estimate = await estimateFromComparables(admin, {
      tenantId,
      districtId: p.district_id,
      propertyType: p.property_type,
      transactionType: p.transaction_type,
      sqm: n(f.sqm),
      excludePropertyId: p.id,
      targetFloor: n(f.floor),
      targetBuildingAge: n(f.building_age),
      targetHeating: typeof f.heating === "string" ? f.heating : null,
      targetFacade: typeof f.facade === "string" ? f.facade : null,
    });
    // Emsal yoksa / güven düşükse fact üretilmez (homeValueDisplay yalnız orta-yüksek + en az 3 emsal verir).
    const display = homeValueDisplay(estimate);
    if (!display) continue;
    seenCustomer.add(d.customer_id);
    out.push({
      dealId: d.id,
      customerId: d.customer_id,
      customerName: c.full_name,
      propertyLabel: p.title ?? p.property_code,
      assignedTo: String(c.assigned_to ?? d.assigned_to),
      boughtAt: d.updated_at.slice(0, 10),
      low: display.low,
      high: display.high,
      compCount: display.compCount,
      confidence: display.confidence,
    });
  }
  return out;
}

/* (e) fiyat revizyonu */
const PRICE_WINDOW_DAYS = PRICE_REVISION_MIN_DAYS;

export async function loadPriceRevisionFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<PriceRevisionFact[]> {
  const stale = await loadStaleListings(admin, tenantId, PRICE_REVISION_MIN_DAYS);
  const candidates = stale.filter((s) => s.peerMedian !== null && s.listPrice > 0);
  if (candidates.length === 0) return [];
  const ids = candidates.map((s) => s.propertyId);
  const since = new Date(nowMs - PRICE_WINDOW_DAYS * DAY).toISOString();

  const changed = new Map<string, number>();
  const booked = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const [hist, appts] = await Promise.all([
      fetchAllRowsKeepError<{ property_id: string; created_at: string }, { message: string; code?: string }>((from, to) =>
        admin
          .from("property_price_history")
          .select("id, property_id, created_at")
          .eq("tenant_id", tenantId)
          .eq("price_field", "list_price")
          .gte("created_at", since)
          .in("property_id", part)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      fetchAllRowsKeepError<{ property_id: string | null }, { message: string; code?: string }>((from, to) =>
        admin
          .from("appointments")
          .select("id, property_id")
          .eq("tenant_id", tenantId)
          .in("property_id", part)
          .neq("status", "cancelled")
          .gte("scheduled_at", since)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    if (hist.error) fail("property_price_history(price_revision)", hist.error);
    if (appts.error) fail("appointments(price_revision)", appts.error);
    for (const h of hist.data) {
      const age = Math.floor((nowMs - Date.parse(h.created_at)) / DAY);
      const cur = changed.get(h.property_id);
      if (cur === undefined || age < cur) changed.set(h.property_id, age);
    }
    for (const a of appts.data) if (a.property_id) booked.set(a.property_id, (booked.get(a.property_id) ?? 0) + 1);
  }

  return candidates.map((s) => ({
    propertyId: s.propertyId,
    assignedTo: s.assignedTo,
    label: s.title ?? s.propertyCode,
    listPrice: s.listPrice,
    daysListed: s.daysListed,
    daysSincePriceChange: changed.get(s.propertyId) ?? null,
    appointmentsLast60: booked.get(s.propertyId) ?? 0,
    peerCount: s.peerCount,
    peerMedian: s.peerMedian,
  }));
}

/* (f) tavsiye daveti */
export async function loadReferralInviteFacts(admin: SupabaseClient, tenantId: string, nowMs: number): Promise<ReferralInviteFact[]> {
  const since = new Date(nowMs - 180 * DAY).toISOString();
  const { data, error } = await admin
    .from("surveys")
    .select("customer_id, score, answered_at, customer:customers!surveys_customer_id_fkey(full_name, assigned_to, is_sample, deleted_at)")
    .eq("tenant_id", tenantId)
    .eq("status", "answered")
    .gte("score", 9)
    .gte("answered_at", since)
    .order("answered_at", { ascending: false })
    .limit(300);
  if (error) fail("surveys(referral_invite)", error);
  const rows = (data ?? []) as unknown as {
    customer_id: string;
    score: number;
    answered_at: string;
    customer: Rel<{ full_name: string | null; assigned_to: string | null; is_sample?: boolean | null; deleted_at?: string | null }>;
  }[];
  const usable = rows.filter((r) => {
    const c = one(r.customer);
    return Boolean(c && !c.is_sample && !c.deleted_at && c.assigned_to);
  });
  if (usable.length === 0) return [];

  const ids = [...new Set(usable.map((r) => r.customer_id))];
  const linked = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const res = await fetchAllRowsKeepError<{ customer_id: string }, { message: string; code?: string }>((from, to) =>
      admin
        .from("referral_links")
        .select("id, customer_id")
        .eq("tenant_id", tenantId)
        .in("customer_id", part)
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (res.error) fail("referral_links(referral_invite)", res.error);
    for (const l of res.data) linked.add(l.customer_id);
  }
  return usable.map((r) => {
    const c = one(r.customer)!;
    return {
      customerId: r.customer_id,
      customerName: c.full_name,
      assignedTo: String(c.assigned_to),
      score: Number(r.score),
      answeredAt: r.answered_at,
      hasReferralLink: linked.has(r.customer_id),
    };
  });
}
