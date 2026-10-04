import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, now, trDayKey } from "@/lib/clock";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { availabilityAt, decidePoolAction, isPoolMode, type PoolDecision, type PoolMode } from "./modes";
import {
  rankCandidates,
  toStoredSuggestions,
  type PoolCandidate,
  type PoolProperty,
  type PoolSuggestion,
  type RegionRow,
  type SpecialtyRow,
} from "./score";

/** Hem oturumlu (RLS) hem service_role istemcisiyle çalışır; tenant süzgeci HER sorguda açıktır. */
export type Db = SupabaseClient;

export type PoolSource = "manual" | "import" | "portal_form" | "network" | "api" | "transfer";

export type PoolRule = {
  id: string | null;
  name: string;
  mode: PoolMode;
  minScore: number | null;
  slaMinutes: number | null;
  escalate: boolean;
};

export const DEFAULT_POOL_RULE: PoolRule = {
  id: null,
  name: "Varsayılan (yarı otomatik)",
  mode: "semi_auto",
  minScore: null,
  slaMinutes: null,
  escalate: true,
};

const ACTIVE_LISTING_STATUSES = ["draft", "live", "reserved"];
const ASSIGNABLE_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Havuz ofiste açık mı? Sütun/şema yoksa (migration uygulanmamış) kapalı sayılır. */
export async function isPoolEnabled(db: Db, tenantId: string): Promise<boolean> {
  const { data, error } = await db.from("tenants").select("listing_pool_enabled").eq("id", tenantId).maybeSingle();
  if (error) return false;
  return (data as Row | null)?.listing_pool_enabled === true;
}

/** Etkin ilan-havuzu kuralı (kaynağa uyan en yüksek öncelikli); yoksa varsayılan. */
export async function loadPoolRule(db: Db, tenantId: string, source: string | null): Promise<PoolRule> {
  const { data, error } = await db
    .from("assignment_rules")
    .select("id, name, source, priority, assign_mode, min_score, sla_minutes, escalate_on_sla_breach")
    .eq("tenant_id", tenantId)
    .eq("target_kind", "listing")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(20);
  if (error || !data?.length) return DEFAULT_POOL_RULE;
  const rows = data as Row[];
  const hit = rows.find((r) => r.source == null || (source != null && r.source === source));
  if (!hit) return DEFAULT_POOL_RULE;
  const mode = isPoolMode(hit.assign_mode) ? hit.assign_mode : "semi_auto";
  return {
    id: str(hit.id),
    name: String(hit.name ?? "Kural"),
    mode,
    minScore: numOrNull(hit.min_score),
    slaMinutes: numOrNull(hit.sla_minutes),
    escalate: hit.escalate_on_sla_breach !== false,
  };
}

/** Yedek zincir: fallback_order sırasıyla müsait üyeler. */
export async function loadFallbackChain(db: Db, tenantId: string, ruleId: string | null): Promise<string[]> {
  if (!ruleId) return [];
  const { data, error } = await db
    .from("assignment_rule_members")
    .select("profile_id, fallback_order, is_available")
    .eq("tenant_id", tenantId)
    .eq("rule_id", ruleId)
    .not("fallback_order", "is", null)
    .order("fallback_order", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).filter((r) => r.is_available !== false).map((r) => String(r.profile_id));
}

async function safeRows(q: PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>): Promise<Row[]> {
  const { data, error } = await q;
  if (error || !Array.isArray(data)) return [];
  return data as Row[];
}

/** Havuz adaylarını ve puanlama bağlamını tablolardan okur (uzmanlık/bölge verisi yalnız okunur). */
export async function loadPoolCandidates(
  db: Db,
  tenantId: string,
  nowMs: number,
  ruleId: string | null,
): Promise<{ candidates: PoolCandidate[]; officeAvgOpen: number }> {
  // profiles: havuz bayrakları migration'a bağlıdır; sütun yoksa bayraksız yeniden dene.
  let profileRows: Row[] = [];
  {
    const full = await db
      .from("profiles")
      .select("id, full_name, role, is_active, accepts_pool, pool_paused_until, max_active_listings")
      .eq("tenant_id", tenantId)
      .in("role", ASSIGNABLE_ROLES)
      .limit(500);
    if (full.error && isMissingSchemaError(full.error)) {
      profileRows = await safeRows(
        db.from("profiles").select("id, full_name, role, is_active").eq("tenant_id", tenantId).in("role", ASSIGNABLE_ROLES).limit(500),
      );
    } else if (!full.error) {
      profileRows = (full.data ?? []) as Row[];
    }
  }
  if (!profileRows.length) return { candidates: [], officeAvgOpen: 0 };

  const today = trDayKey(nowMs);
  const since90 = daysAgoIso(90);
  const [specRows, regionRows, leaveRows, openRows, memberRows, assignedRows, recentProps, recentDeals] = await Promise.all([
    safeRows(
      db
        .from("advisor_specialties")
        .select("profile_id, kind, value, transaction_type, price_min, price_max, level")
        .eq("tenant_id", tenantId)
        .limit(5000),
    ),
    safeRows(
      db
        .from("advisor_regions")
        .select("profile_id, province_id, district_id, neighborhood_id, weight")
        .eq("tenant_id", tenantId)
        .limit(5000),
    ),
    safeRows(
      db
        .from("staff_leaves")
        .select("staff_id")
        .eq("tenant_id", tenantId)
        .eq("status", "onayli")
        .lte("starts_on", today)
        .gte("ends_on", today)
        .limit(1000),
    ),
    safeRows(
      db
        .from("properties")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .in("status", ACTIVE_LISTING_STATUSES)
        .is("deleted_at", null)
        .not("assigned_to", "is", null)
        .limit(20000),
    ),
    ruleId
      ? safeRows(
          db
            .from("assignment_rule_members")
            .select("profile_id, weight, is_available, max_open")
            .eq("tenant_id", tenantId)
            .eq("rule_id", ruleId)
            .limit(1000),
        )
      : Promise.resolve([] as Row[]),
    safeRows(
      db
        .from("listing_pool_entries")
        .select("assigned_to, assigned_at")
        .eq("tenant_id", tenantId)
        .eq("status", "assigned")
        .not("assigned_at", "is", null)
        .order("assigned_at", { ascending: false })
        .limit(500),
    ),
    safeRows(
      db
        .from("properties")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .gte("created_at", since90)
        .is("deleted_at", null)
        .not("assigned_to", "is", null)
        .limit(20000),
    ),
    safeRows(
      db
        .from("deals")
        .select("assigned_to")
        .eq("tenant_id", tenantId)
        .eq("stage", "won")
        .gte("created_at", since90)
        .not("assigned_to", "is", null)
        .limit(20000),
    ),
  ]);

  const count = (rows: Row[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const id = str(r.assigned_to);
      if (id) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  };
  const openBy = count(openRows);
  const listingsBy = count(recentProps);
  const dealsBy = count(recentDeals);
  const onLeave = new Set(leaveRows.map((r) => String(r.staff_id)));
  const members = new Map(memberRows.map((r) => [String(r.profile_id), r]));
  const lastAssigned = new Map<string, number>();
  for (const r of assignedRows) {
    const id = str(r.assigned_to);
    const at = str(r.assigned_at);
    if (id && at && !lastAssigned.has(id)) lastAssigned.set(id, Date.parse(at));
  }
  const specsBy = new Map<string, SpecialtyRow[]>();
  for (const r of specRows) {
    const id = String(r.profile_id);
    const list = specsBy.get(id) ?? [];
    list.push({
      kind: r.kind === "segment" ? "segment" : "property_type",
      value: String(r.value ?? ""),
      transactionType: str(r.transaction_type),
      priceMin: numOrNull(r.price_min),
      priceMax: numOrNull(r.price_max),
      level: numOrNull(r.level) ?? 2,
    });
    specsBy.set(id, list);
  }
  const regionsBy = new Map<string, RegionRow[]>();
  for (const r of regionRows) {
    const id = String(r.profile_id);
    const list = regionsBy.get(id) ?? [];
    list.push({
      provinceId: String(r.province_id),
      districtId: str(r.district_id),
      neighborhoodId: str(r.neighborhood_id),
      weight: numOrNull(r.weight) ?? 3,
    });
    regionsBy.set(id, list);
  }

  const availability = availabilityAt(nowMs);
  const candidates: PoolCandidate[] = profileRows.map((p) => {
    const id = String(p.id);
    const member = members.get(id);
    const paused = str(p.pool_paused_until);
    const profileCap = numOrNull(p.max_active_listings);
    const memberCap = numOrNull(member?.max_open);
    const listings = listingsBy.get(id) ?? 0;
    return {
      profileId: id,
      name: String(p.full_name ?? "Danışman"),
      isActive: p.is_active !== false,
      acceptsPool: p.accepts_pool !== false,
      pausedUntilMs: paused ? Date.parse(paused) : null,
      onLeave: onLeave.has(id),
      ruleUnavailable: member ? member.is_available === false : false,
      licenseExpired: false,
      openListings: openBy.get(id) ?? 0,
      capacity: profileCap ?? memberCap,
      specialties: specsBy.get(id) ?? [],
      regions: regionsBy.get(id) ?? [],
      performance: listings > 0 ? { listings, deals: dealsBy.get(id) ?? 0 } : null,
      availability,
      lastAssignedAtMs: lastAssigned.get(id) ?? null,
      ruleWeight: numOrNull(member?.weight) ?? 1,
    };
  });
  const active = candidates.filter((c) => c.isActive);
  const officeAvgOpen = active.length ? active.reduce((n, c) => n + c.openListings, 0) / active.length : 0;
  return { candidates, officeAvgOpen };
}

/** properties satırı -> puanlama girdisi. */
export function toPoolProperty(row: Row): PoolProperty {
  return {
    propertyType: str(row.property_type),
    transactionType: str(row.transaction_type),
    provinceId: str(row.province_id),
    districtId: str(row.district_id),
    neighborhoodId: str(row.neighborhood_id),
    listPrice: numOrNull(row.list_price),
  };
}

/** Bir ilan için sıralı, açıklanabilir öneri listesi. */
export async function computeSuggestions(
  db: Db,
  tenantId: string,
  property: PoolProperty,
  nowMs: number,
  ruleId: string | null,
  labels?: { neighborhood?: string; district?: string; province?: string },
): Promise<PoolSuggestion[]> {
  const { candidates, officeAvgOpen } = await loadPoolCandidates(db, tenantId, nowMs, ruleId);
  return rankCandidates(candidates, property, { nowMs, officeAvgOpen, labels });
}

export type EnqueueInput = {
  tenantId: string;
  propertyId: string;
  actorId: string | null;
  source: PoolSource;
  property: PoolProperty;
};

export type EnqueueResult =
  | { queued: false; reason: "disabled" | "duplicate" | "error" }
  | { queued: true; entryId: string; decision: PoolDecision; topScore: number | null; rule: PoolRule };

/**
 * Havuz kaydı açar (status=pending), öneri üretir, olayları yazar ve moda göre karar verir.
 * Havuz kapalıysa veya şema yoksa hiçbir şey yapmaz: mevcut portföy akışı aynıdır. Hata ASLA fırlatılmaz.
 * Otomatik atama (service_role RPC) çağıran tarafça `applyAutoAssign` ile yapılır (karar döner).
 */
export async function enqueueListingPool(db: Db, input: EnqueueInput): Promise<EnqueueResult> {
  try {
    if (!(await isPoolEnabled(db, input.tenantId))) return { queued: false, reason: "disabled" };
    const nowMs = now();
    const rule = await loadPoolRule(db, input.tenantId, input.source);
    const suggestions = await computeSuggestions(db, input.tenantId, input.property, nowMs, rule.id);
    const top = suggestions.find((s) => !s.excluded) ?? null;
    const decision = decidePoolAction({ mode: rule.mode, suggestions, minScore: rule.minScore, slaMinutes: rule.slaMinutes, nowMs });
    const slaDue = rule.slaMinutes ? new Date(nowMs + rule.slaMinutes * 60_000).toISOString() : null;

    const { data, error } = await db
      .from("listing_pool_entries")
      .insert({
        tenant_id: input.tenantId,
        property_id: input.propertyId,
        source: input.source,
        status: "pending",
        rule_id: rule.id,
        suggestions: toStoredSuggestions(suggestions),
        top_score: top ? top.score : null,
        suggested_at: new Date(nowMs).toISOString(),
        sla_due_at: slaDue,
        claim_open_until: decision.kind === "open_claim" ? new Date(decision.claimOpenUntilMs).toISOString() : null,
        created_by: input.actorId,
      })
      .select("id")
      .single();
    if (error || !data) {
      if (error?.code === "23505") return { queued: false, reason: "duplicate" };
      if (!isMissingSchemaError(error)) console.error("enqueueListingPool", error);
      return { queued: false, reason: "error" };
    }
    const entryId = String((data as Row).id);
    const events: Row[] = [
      { tenant_id: input.tenantId, entry_id: entryId, event: "created", actor_id: input.actorId, detail: { source: input.source, mode: rule.mode } },
      {
        tenant_id: input.tenantId,
        entry_id: entryId,
        event: "suggested",
        actor_id: null,
        score: top ? top.score : null,
        to_profile_id: top ? top.profileId : null,
        detail: { candidates: suggestions.filter((s) => !s.excluded).length, excluded: suggestions.filter((s) => s.excluded).length },
      },
    ];
    if (decision.kind === "open_claim") {
      events.push({
        tenant_id: input.tenantId,
        entry_id: entryId,
        event: "claim_opened",
        actor_id: null,
        detail: { until: new Date(decision.claimOpenUntilMs).toISOString(), eligible: decision.eligibleProfileIds.length },
      });
    }
    await db.from("listing_pool_events").insert(events);
    return { queued: true, entryId, decision, topScore: top ? top.score : null, rule };
  } catch (e) {
    console.error("enqueueListingPool", e);
    return { queued: false, reason: "error" };
  }
}

/** Ofis yöneticileri (owner/gm) — bildirim/görev hedefi. */
export async function loadOfficeManagers(db: Db, tenantId: string): Promise<{ id: string; role: string }[]> {
  const rows = await safeRows(
    db.from("profiles").select("id, role").eq("tenant_id", tenantId).eq("is_active", true).in("role", ["owner", "gm"]).limit(20),
  );
  return rows.map((r) => ({ id: String(r.id), role: String(r.role) }));
}
