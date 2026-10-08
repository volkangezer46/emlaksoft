import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoIso, now } from "@/lib/clock";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { notifyTenant } from "@/lib/notify";
import { loadOfficeManagers, loadPoolCandidates } from "@/lib/pool/server";
import { loadLeadResponses } from "@/lib/response-time/load";
import { normalizeWeights } from "@/lib/office-center/smart-assign";
import { OPEN_DEMAND_STATUSES } from "@/lib/team/advisor-360";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { getSettingDef } from "@/lib/settings/registry";
import { coerceInput } from "@/lib/settings/view";
import { ASSIGN_WEIGHT_KEYS, LEAD_ROUTING_KEYS } from "@/lib/settings/registry/tenant";
import {
  DEFAULT_LEAD_ROUTING,
  decideReassign,
  leadRoutingConfigFrom,
  pickLeadAssignee,
  shouldDeferAssignment,
  withinBusinessHours,
  type LeadCandidate,
  type LeadFacts,
  type LeadRoutingConfig,
} from "./logic";

/**
 * Talep dağıtımı — veri katmanı. İstemciyi ÇAĞIRAN verir (public form: `lead-intake.ts`; cron: `havuz-atama` adımı); bu dosya
 * yeni bir service_role istemcisi OLUŞTURMAZ. Her sorgu `tenant_id` süzgeçlidir. Aday yükleyici ilan havuzunun
 * `loadPoolCandidates` fonksiyonudur (uzmanlık, bölge, izin, duraklatma, kural üyeliği) — mükerrer yoktur.
 */
type Db = SupabaseClient;
type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function loadLeadRoutingConfig(db: Db, tenantId: string): Promise<LeadRoutingConfig> {
  try {
    const values = await readTenantSettings(db, tenantId, Object.values(LEAD_ROUTING_KEYS));
    return leadRoutingConfigFrom(values, LEAD_ROUTING_KEYS);
  } catch {
    return DEFAULT_LEAD_ROUTING;
  }
}

async function paged(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await fetchAllRows<Row>(build);
  return error ? [] : data;
}

/** Etkin talep kuralı (varsa): üye müsaitliği/ağırlığı için. Yoksa null. */
async function loadLeadRuleId(db: Db, tenantId: string): Promise<string | null> {
  const { data, error } = await db
    .from("assignment_rules")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("target_kind", "lead")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return str((data as Row).id) || null;
}

export type LeadRoutingBundle = {
  candidates: LeadCandidate[];
  officeAvgOpen: number;
  officeAvgLoad: number;
  weights: ReturnType<typeof normalizeWeights>;
};

/** Aday listesi: havuz adayı + rol + açık talep sayısı + son talep ataması. Kapasite talepte uygulanmaz. */
export async function loadLeadCandidates(db: Db, tenantId: string, nowMs: number): Promise<LeadRoutingBundle> {
  const ruleId = await loadLeadRuleId(db, tenantId);
  const [{ candidates, officeAvgOpen }, profiles, demands, assigned, settings] = await Promise.all([
    loadPoolCandidates(db, tenantId, nowMs, ruleId),
    db.from("profiles").select("id, role, branch_id").eq("tenant_id", tenantId).limit(500),
    paged((from, to) =>
      db
        .from("customer_demands")
        .select("id, customer:customers!customer_demands_customer_id_fkey!inner(assigned_to)")
        .eq("tenant_id", tenantId)
        .in("status", [...OPEN_DEMAND_STATUSES])
        .not("customer.assigned_to", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    db
      .from("customers")
      .select("assigned_to, created_at")
      .eq("tenant_id", tenantId)
      .eq("auto_assigned", true)
      .is("deleted_at", null)
      .not("assigned_to", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    readTenantSettings(db, tenantId, Object.values(ASSIGN_WEIGHT_KEYS)),
  ]);

  const meta = new Map(((profiles.data ?? []) as Row[]).map((p) => [str(p.id), { role: str(p.role) || "advisor", branchId: str(p.branch_id) || null }]));
  const demandBy = new Map<string, number>();
  for (const d of demands) {
    const c = d.customer as Row | Row[] | null;
    const owner = str((Array.isArray(c) ? c[0] : c)?.assigned_to);
    if (owner) demandBy.set(owner, (demandBy.get(owner) ?? 0) + 1);
  }
  const lastBy = new Map<string, number>();
  for (const r of (assigned.data ?? []) as Row[]) {
    const id = str(r.assigned_to);
    const at = Date.parse(str(r.created_at));
    if (id && Number.isFinite(at) && !lastBy.has(id)) lastBy.set(id, at);
  }

  const list: LeadCandidate[] = candidates.map((c) => ({
    ...c,
    // Havuz bayrağı/ilan kapasitesi İLAN içindir; talep dağıtımını etkilemez.
    acceptsPool: true,
    capacity: null,
    role: meta.get(c.profileId)?.role ?? "advisor",
    branchId: meta.get(c.profileId)?.branchId ?? null,
    teamId: null,
    openDemands: demandBy.get(c.profileId) ?? 0,
    slaWithinPct: null,
    lastActivityAtMs: null,
    lastAssignedAtMs: lastBy.get(c.profileId) ?? null,
  }));
  const active = list.filter((c) => c.isActive);
  const officeAvgLoad = active.length ? active.reduce((t, c) => t + c.openListings + c.openDemands, 0) / active.length : 0;
  const w = (k: keyof typeof ASSIGN_WEIGHT_KEYS) => {
    const v = settings[ASSIGN_WEIGHT_KEYS[k]];
    return typeof v === "number" ? v : undefined;
  };
  return {
    candidates: list,
    officeAvgOpen,
    officeAvgLoad,
    weights: normalizeWeights({ workload: w("workload"), specialty: w("specialty"), region: w("region"), performance: w("performance"), availability: w("availability") }),
  };
}

export type RouteResult = { assigneeId: string | null; deferred: boolean; strategy: LeadRoutingConfig["strategy"]; reason: string };

/**
 * Yeni gelen talep için sorumlu seçer (TEK giriş: vitrin, portal, başvuru formu ve API hepsi `intakeLead` üzerinden buraya gelir).
 * Hata ASLA fırlatılmaz; çağıran `ok:false` görürse eski "en az yüklü" yoluna düşer.
 */
export async function routeNewLead(db: Db, tenantId: string, lead: LeadFacts, nowMs: number, excludeIds: readonly string[] = []): Promise<RouteResult & { ok: boolean }> {
  try {
    const config = await loadLeadRoutingConfig(db, tenantId);
    if (shouldDeferAssignment(config, nowMs)) {
      return { ok: true, assigneeId: null, deferred: true, strategy: config.strategy, reason: "Mesai dışı: mesai başında dağıtılacak" };
    }
    const bundle = await loadLeadCandidates(db, tenantId, nowMs);
    const decision = pickLeadAssignee({
      strategy: config.strategy,
      candidates: bundle.candidates,
      lead,
      excludeIds,
      ctx: { nowMs, officeAvgOpen: bundle.officeAvgOpen, officeAvgLoad: bundle.officeAvgLoad, weights: bundle.weights },
    });
    return { ok: true, assigneeId: decision.profileId, deferred: false, strategy: decision.strategy, reason: decision.reason };
  } catch (e) {
    console.error("routeNewLead", e);
    return { ok: false, assigneeId: null, deferred: false, strategy: DEFAULT_LEAD_ROUTING.strategy, reason: "Dağıtım motoru hatası" };
  }
}

export type LeadSweepSummary = { tenants: number; assignedDeferred: number; reassigned: number; escalated: number };

const SWEEP_TENANT_CAP = 50;
const SWEEP_PER_TENANT_CAP = 20;
const SWEEP_WINDOW_DAYS = 3;

/** SLA/mesai süpürmesi için sorumlu olacak ofisler: yeniden atama VEYA mesai ertelemesi açık olanlar. */
async function sweepTenants(db: Db): Promise<string[]> {
  const { data } = await db
    .from("tenant_settings")
    .select("tenant_id, key, value")
    .in("key", [LEAD_ROUTING_KEYS.reassign, LEAD_ROUTING_KEYS.hoursOnly])
    .limit(2000);
  const ids = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    const def = getSettingDef(str(r.key));
    const parsed = def ? coerceInput(def, r.value) : null;
    if (parsed?.ok && parsed.value === true) ids.add(str(r.tenant_id));
  }
  ids.delete("");
  return [...ids].slice(0, SWEEP_TENANT_CAP);
}

async function safeNotify(input: Parameters<typeof notifyTenant>[0]) {
  try {
    await notifyTenant(input);
  } catch (e) {
    console.error("talep dagitimi notify", e);
  }
}

async function auditCounts(db: Db, tenantId: string, action: string, customerIds: string[]): Promise<Map<string, { count: number; lastMs: number }>> {
  const out = new Map<string, { count: number; lastMs: number }>();
  if (!customerIds.length) return out;
  const { data } = await db
    .from("audit_logs")
    .select("entity_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("action", action)
    .in("entity_id", customerIds)
    .limit(2000);
  for (const r of (data ?? []) as Row[]) {
    const id = str(r.entity_id);
    const at = Date.parse(str(r.created_at));
    const cur = out.get(id) ?? { count: 0, lastMs: 0 };
    out.set(id, { count: cur.count + 1, lastMs: Number.isFinite(at) ? Math.max(cur.lastMs, at) : cur.lastMs });
  }
  return out;
}

/**
 * Cron adımı (havuz-atama, 10 dk; yeni cron YOK):
 *  1) "mesai başında dağıt" açık ofiste, mesai dışı gelip atanmamış kalan talepler mesai içindeyse atanır;
 *  2) "SLA aşımında yeniden ata" açık ofiste, çalışma saatiyle ilk dönüş süresi dolan talep başka danışmana devredilir
 *     (eski + yeni sorumluya bildirim); üst sınır dolunca yöneticilere BİR KEZ uyarı. Atamadan sonra yeni süre tanınır.
 */
export async function runLeadRoutingSweep(db: Db): Promise<LeadSweepSummary> {
  const summary: LeadSweepSummary = { tenants: 0, assignedDeferred: 0, reassigned: 0, escalated: 0 };
  const nowMs = now();
  const tenantIds = await sweepTenants(db);
  for (const tenantId of tenantIds) {
    try {
      const config = await loadLeadRoutingConfig(db, tenantId);
      summary.tenants += 1;
      const since = daysAgoIso(SWEEP_WINDOW_DAYS);

      // 1) Mesai ertelemesi: atanmamış talepleri dağıt.
      if (config.hoursOnly && withinBusinessHours(nowMs)) {
        const { data: open } = await db
          .from("customers")
          .select("id, full_name, province_id")
          .eq("tenant_id", tenantId)
          .is("assigned_to", null)
          .is("deleted_at", null)
          .eq("is_sample", false)
          .not("lead_channel", "is", null)
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(SWEEP_PER_TENANT_CAP);
        for (const c of (open ?? []) as Row[]) {
          const route = await routeNewLead(db, tenantId, { provinceId: str(c.province_id) || null }, nowMs);
          if (!route.ok || !route.assigneeId) continue;
          const { error } = await db.from("customers").update({ assigned_to: route.assigneeId, auto_assigned: true }).eq("id", str(c.id)).eq("tenant_id", tenantId).is("assigned_to", null);
          if (error) continue;
          summary.assignedDeferred += 1;
          await db.from("audit_logs").insert({ tenant_id: tenantId, actor_id: null, action: "lead.deferred_assign", entity_type: "customer", entity_id: str(c.id), new_value: { assigned_to: route.assigneeId, strategy: route.strategy } });
          await safeNotify({ tenantId, userId: route.assigneeId, title: "Yeni talep size atandı", body: `${str(c.full_name) || "Müşteri"} · mesai dışı gelen talep`, href: `/app/musteriler/${str(c.id)}`, kind: "success" });
        }
      }

      // 2) SLA yeniden atama.
      if (config.reassignOnBreach) {
        const res = await loadLeadResponses(db, { tenantId, startIso: since, endIso: new Date(nowMs + 60_000).toISOString(), slaMin: config.slaMinutes, nowMs });
        if (res.failed) continue;
        const waiting = res.rows.filter((r) => !r.responded && r.assignedTo).slice(0, 200);
        if (!waiting.length) continue;
        const ids = waiting.map((r) => r.customerId);
        const [reassigns, escalations, realCustomers] = await Promise.all([
          auditCounts(db, tenantId, "lead.sla_reassign", ids),
          auditCounts(db, tenantId, "lead.sla_escalate", ids),
          db.from("customers").select("id, province_id").eq("tenant_id", tenantId).eq("is_sample", false).in("id", ids),
        ]);
        const real = new Map(((realCustomers.data ?? []) as Row[]).map((r) => [str(r.id), r]));
        let handled = 0;
        for (const lead of waiting) {
          if (handled >= SWEEP_PER_TENANT_CAP) break;
          const row = real.get(lead.customerId);
          if (!row) continue;
          const past = reassigns.get(lead.customerId);
          const decision = decideReassign({
            enabled: true,
            createdAt: lead.createdAt,
            lastAssignedAt: past && past.lastMs ? new Date(past.lastMs).toISOString() : null,
            responded: false,
            nowMs,
            slaMinutes: config.slaMinutes,
            reassignCount: past?.count ?? 0,
            maxReassign: config.maxReassign,
          });
          if (decision === "wait") continue;
          handled += 1;
          if (decision === "escalate") {
            if (escalations.has(lead.customerId)) continue;
            await db.from("audit_logs").insert({ tenant_id: tenantId, actor_id: null, action: "lead.sla_escalate", entity_type: "customer", entity_id: lead.customerId, new_value: { sla_minutes: config.slaMinutes, reassigns: past?.count ?? 0 } });
            for (const m of await loadOfficeManagers(db, tenantId)) {
              await safeNotify({ tenantId, userId: m.id, title: "Talebe süresi içinde dönülmedi", body: `${lead.name} · yeniden atama sınırı doldu, elle ilgilenin`, href: `/app/musteriler/${lead.customerId}`, kind: "warning" });
            }
            summary.escalated += 1;
            continue;
          }
          const route = await routeNewLead(db, tenantId, { provinceId: str(row.province_id) || null }, nowMs, [lead.assignedTo as string]);
          if (!route.ok || !route.assigneeId) continue;
          const { error } = await db.from("customers").update({ assigned_to: route.assigneeId, auto_assigned: true }).eq("id", lead.customerId).eq("tenant_id", tenantId).eq("assigned_to", lead.assignedTo as string);
          if (error) continue;
          summary.reassigned += 1;
          await db.from("audit_logs").insert({
            tenant_id: tenantId,
            actor_id: null,
            action: "lead.sla_reassign",
            entity_type: "customer",
            entity_id: lead.customerId,
            new_value: { from: lead.assignedTo, to: route.assigneeId, strategy: route.strategy, sla_minutes: config.slaMinutes },
          });
          await safeNotify({ tenantId, userId: route.assigneeId, title: "Talep size devredildi", body: `${lead.name} · önceki danışman süresi içinde dönmedi`, href: `/app/musteriler/${lead.customerId}`, kind: "warning" });
          await safeNotify({ tenantId, userId: lead.assignedTo as string, title: "Talep başka danışmana devredildi", body: `${lead.name} · ilk dönüş süresi doldu`, href: `/app/musteriler/${lead.customerId}`, kind: "info" });
        }
      }
    } catch (e) {
      console.error("runLeadRoutingSweep", { tenantId }, e);
    }
  }
  return summary;
}
