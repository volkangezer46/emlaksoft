"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getAdapter } from "@/lib/listing-control/adapters";
import { isAllowedProbeUrl } from "@/lib/listing-control/worker/core";
import { isMissingSchema } from "@/lib/listing-control/server/db";
import { sanitizeObserved } from "@/lib/listing-control/server/process-check";
import { CHECK_RESULTS, type CheckResultKind } from "@/lib/listing-control/types";

/**
 * Tarayıcı doğrulama işçisinin sunucu eylemleri. Hepsi `requirePermission("portals","edit")` kapısından geçer ve
 * KULLANICI OTURUMU (JWT) istemcisiyle `lc_worker_*` RPC'lerini çağırır: yönetici (service_role) istemcisi YOK, kabul
 * listesine satır eklenmez. Ofis ve kullanıcı RPC içinde JWT'den çıkar; istemci kimliği (cihaz) kullanıcıya bağlıdır.
 * Sunucu portala istek ATMAZ; yalnız iş dağıtır ve istemcinin bildirdiği sınırlı gözlemi işler.
 */

export type WorkerJob = { jobId: string; listingId: string; portal: string; externalId: string | null; url: string | null };
export type WorkerActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; outcome?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: { code?: string | null } | null, outcome?: string): { ok: false; error: string; outcome?: string } {
  if (error) {
    if (!isMissingSchema(error)) console.error("listing-control-worker", { code: error.code });
    return { ok: false, error: isMissingSchema(error) ? "schema_missing" : "rpc_error" };
  }
  return { ok: false, error: outcome ?? "failed", outcome };
}

export async function workerRegister(deviceKey: string, label: string, bridgeVersion: string): Promise<WorkerActionResult<{ clientId: string }>> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: "forbidden" };
  if (typeof deviceKey !== "string" || deviceKey.length < 16 || deviceKey.length > 80) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_worker_register", {
    p_device_key: deviceKey,
    p_label: String(label ?? "").slice(0, 80) || "Tarayıcı",
    p_capabilities: { bridge: "extension", version: String(bridgeVersion ?? "").slice(0, 20) },
  });
  if (error) return fail(error);
  const r = (data ?? {}) as { outcome?: string; client_id?: string };
  if (r.outcome !== "ok" || !r.client_id) return fail(null, r.outcome);
  return { ok: true, clientId: r.client_id };
}

export async function workerClaim(clientId: string): Promise<WorkerActionResult<{ jobs: WorkerJob[]; status: "ok" | "busy" | "rate_limited" }>> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: "forbidden" };
  if (!UUID.test(clientId)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_worker_claim", { p_client_id: clientId, p_limit: 1 });
  if (error) return fail(error);
  const r = (data ?? {}) as { outcome?: string; jobs?: { job_id: string; listing_id: string; portal: string; external_id: string | null; url: string | null }[] };
  if (r.outcome === "busy" || r.outcome === "rate_limited") return { ok: true, jobs: [], status: r.outcome };
  if (r.outcome !== "ok") return fail(null, r.outcome);
  const jobs: WorkerJob[] = (r.jobs ?? []).map((j) => {
    // Köprüye YALNIZ adaptörün tanıdığı host'taki https URL gider; aksi halde URL null (işçi işi bırakır).
    const hosts = getAdapter(j.portal)?.hosts ?? [];
    return {
      jobId: j.job_id,
      listingId: j.listing_id,
      portal: j.portal,
      externalId: j.external_id,
      url: isAllowedProbeUrl(j.url, hosts) ? j.url : null,
    };
  });
  return { ok: true, jobs, status: "ok" };
}

export async function workerComplete(input: {
  clientId: string;
  jobId: string;
  result: CheckResultKind;
  observed: Record<string, unknown>;
}): Promise<WorkerActionResult<{ outcome: string; stateAfter: string | null }>> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: "forbidden" };
  if (!UUID.test(input.clientId) || !UUID.test(input.jobId) || !CHECK_RESULTS.includes(input.result)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_worker_complete", {
    p_client_id: input.clientId,
    p_job_id: input.jobId,
    p_result: input.result,
    p_observed: sanitizeObserved(input.observed),
    p_evidence_hash: null,
  });
  if (error) return fail(error);
  const r = (data ?? {}) as { outcome?: string; state_after?: string };
  if (r.outcome !== "applied" && r.outcome !== "replay") return fail(null, r.outcome);
  return { ok: true, outcome: r.outcome, stateAfter: r.state_after ?? null };
}

export async function workerRelease(clientId: string, jobId: string, reason: string): Promise<WorkerActionResult> {
  const gate = await requirePermission("portals", "edit");
  if (!gate.ok) return { ok: false, error: "forbidden" };
  if (!UUID.test(clientId) || !UUID.test(jobId)) return { ok: false, error: "invalid_input" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lc_worker_release", { p_client_id: clientId, p_job_id: jobId, p_reason: String(reason ?? "").slice(0, 60) });
  if (error) return fail(error);
  const outcome = (data as { outcome?: string } | null)?.outcome;
  if (outcome !== "released") return fail(null, outcome);
  return { ok: true };
}
