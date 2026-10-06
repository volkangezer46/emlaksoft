import { decideCadence } from "../cadence";
import type { ListingControlConfig } from "../config";
import type { CheckState } from "../types";
import { chunk, isMissingSchema, type Db } from "./db";

/**
 * Kontrol KUYRUĞU (sunucu): planlama, hasat, talep. Kuyruk yalnız çevrimiçi kontrol istemcisi (cihaz) olan ofisler
 * içindir; istemcisi olmayan ofiste "bugün teyit edilecekler" listesi `portal_listing_health.next_check_at`'ten okunur
 * (iş üretilmez). Aynı ilan için tek açık iş DB'de garanti (kısmi unique); talep `FOR UPDATE SKIP LOCKED` ile
 * (iki cihaz aynı ilanı alamaz), lease dolarsa `reapJobs` işi kuyruğa döndürür (3. denemede failed). Saatlik hız sınırı
 * RPC'dedir. service_role istemcisi ÇAĞIRAN tarafından verilir.
 */

export type PlanSummary = { tenantsWithClients: number; considered: number; enqueued: number; schemaMissing: boolean };

type HealthDue = {
  portal_listing_id: string;
  property_id: string;
  check_state: CheckState;
  check_failures: number;
  last_check_at: string | null;
  next_check_at: string | null;
  absent_client_ids: string[] | null;
  consecutive_absent: number;
};

/** Planlanan iş sayısı için üst sınır (tur başına; adil paylaşım ofis başına eşit parçalanır). */
const PER_TENANT_LIMIT = 100;
const TOTAL_LIMIT = 1000;

export async function planVerificationJobs(db: Db, cfgFor: (tenantId: string) => Promise<ListingControlConfig>, nowMs: number): Promise<PlanSummary> {
  const summary: PlanSummary = { tenantsWithClients: 0, considered: 0, enqueued: 0, schemaMissing: false };
  const { data: clients, error: cErr } = await db
    .from("verification_clients")
    .select("id, tenant_id")
    .is("revoked_at", null)
    .gte("last_seen_at", new Date(nowMs - 7 * 86_400_000).toISOString());
  if (cErr) {
    summary.schemaMissing = isMissingSchema(cErr);
    return summary;
  }
  const clientsByTenant = new Map<string, number>();
  for (const c of (clients ?? []) as { id: string; tenant_id: string }[]) clientsByTenant.set(c.tenant_id, (clientsByTenant.get(c.tenant_id) ?? 0) + 1);
  summary.tenantsWithClients = clientsByTenant.size;
  let budget = TOTAL_LIMIT;
  const nowIso = new Date(nowMs).toISOString();

  for (const [tenantId, clientCount] of clientsByTenant) {
    if (budget <= 0) break;
    const cfg = await cfgFor(tenantId);
    const { data: due, error } = await db
      .from("portal_listing_health")
      .select("portal_listing_id, property_id, check_state, check_failures, last_check_at, next_check_at, absent_client_ids, consecutive_absent")
      .eq("tenant_id", tenantId)
      .neq("check_state", "paused")
      .lte("next_check_at", nowIso)
      .order("next_check_at", { ascending: true })
      .limit(Math.min(PER_TENANT_LIMIT, budget));
    if (error) {
      if (isMissingSchema(error)) summary.schemaMissing = true;
      continue;
    }
    const dueRows = (due ?? []) as HealthDue[];

    // Hiç sağlık kaydı olmayan canlı ilanlar (yeni bağlanan) hemen kontrol edilir.
    const room = Math.min(PER_TENANT_LIMIT, budget) - dueRows.length;
    let fresh: { id: string; property_id: string }[] = [];
    if (room > 0) {
      const { data: live } = await db
        .from("portal_listings")
        .select("id, property_id")
        .eq("tenant_id", tenantId)
        .eq("status", "live")
        .order("created_at", { ascending: false })
        .limit(room * 3);
      const liveRows = (live ?? []) as { id: string; property_id: string }[];
      if (liveRows.length) {
        const { data: have } = await db.from("portal_listing_health").select("portal_listing_id").eq("tenant_id", tenantId).in("portal_listing_id", liveRows.map((l) => l.id));
        const haveSet = new Set(((have ?? []) as { portal_listing_id: string }[]).map((h) => h.portal_listing_id));
        fresh = liveRows.filter((l) => !haveSet.has(l.id)).slice(0, room);
      }
    }

    const jobs: Record<string, unknown>[] = [];
    for (const h of dueRows) {
      summary.considered += 1;
      const d = decideCadence(
        {
          state: h.check_state,
          publishedAt: null,
          lastCheckAt: h.last_check_at,
          nextCheckAt: h.next_check_at,
          checkFailures: h.check_failures,
          riskScore: 0,
          priceMismatch: false,
          authorityIssue: false,
        },
        nowMs,
        cfg.cadence,
      );
      if (!d || !d.due) continue;
      // 3. gözlem için MÜMKÜNSE farklı istemci: 2+ cihaz varsa önceki "yok" diyenleri dışla.
      const third = h.check_state === "probable_missing" && clientCount >= 2;
      jobs.push({
        portal_listing_id: h.portal_listing_id,
        priority: d.priority,
        reason: h.check_state === "suspect" || h.check_state === "probable_missing" ? (third ? "third_party" : "suspect_recheck") : "scheduled",
        scheduled_at: nowIso,
        exclude_client_ids: third ? (h.absent_client_ids ?? []) : [],
      });
    }
    for (const f of fresh) {
      summary.considered += 1;
      jobs.push({ portal_listing_id: f.id, priority: 60, reason: "scheduled", scheduled_at: nowIso, exclude_client_ids: [] });
    }
    for (const part of chunk(jobs, 200)) {
      const { data: n, error: e } = await db.rpc("lc_enqueue_verification_jobs", { p_tenant_id: tenantId, p_jobs: part });
      if (e) {
        if (isMissingSchema(e)) summary.schemaMissing = true;
        else console.error("lc_enqueue_verification_jobs", { code: e.code });
        break;
      }
      summary.enqueued += Number(n ?? 0);
      budget -= part.length;
    }
  }
  return summary;
}

/** Lease'i dolan işleri kuyruğa döndürür / üçüncü denemede failed yapar. */
export async function reapJobs(db: Db): Promise<{ requeued: number; failed: number }> {
  const { data, error } = await db.rpc("lc_reap_verification_jobs");
  if (error) {
    if (!isMissingSchema(error)) console.error("lc_reap_verification_jobs", { code: error.code });
    return { requeued: 0, failed: 0 };
  }
  const r = (data ?? {}) as { requeued?: number; failed?: number };
  return { requeued: Number(r.requeued ?? 0), failed: Number(r.failed ?? 0) };
}

export type ClaimedJob = { job_id: string; listing_id: string; portal: string; external_id: string | null; url: string | null };

/** İstemci için iş al (SKIP LOCKED + lease + saatlik sınır). Cevap kişisel veri/fiyat İÇERMEZ. */
export async function claimJobs(
  db: Db,
  input: { tenantId: string; clientId: string; limit?: number; leaseSeconds?: number; maxPerHour?: number },
): Promise<{ outcome: "ok" | "client_invalid" | "rate_limited" | "error"; jobs: ClaimedJob[] }> {
  const { data, error } = await db.rpc("lc_claim_verification_jobs", {
    p_tenant_id: input.tenantId,
    p_client_id: input.clientId,
    p_limit: Math.min(Math.max(input.limit ?? 3, 1), 3),
    p_lease_seconds: input.leaseSeconds ?? 180,
    p_max_per_hour: input.maxPerHour ?? 120,
  });
  if (error) {
    if (!isMissingSchema(error)) console.error("lc_claim_verification_jobs", { code: error.code });
    return { outcome: "error", jobs: [] };
  }
  const r = (data ?? {}) as { outcome?: string; jobs?: ClaimedJob[] };
  const outcome = r.outcome === "ok" || r.outcome === "client_invalid" || r.outcome === "rate_limited" ? r.outcome : "error";
  return { outcome, jobs: Array.isArray(r.jobs) ? r.jobs : [] };
}
