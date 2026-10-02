import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 8;

type JsonObject = Record<string, unknown>;

type ClaimedPublicMutationEffect = {
  id: string;
  tenantId: string;
  leaseToken: string;
};

export type PublicMutationOutboxSummary = {
  claimed: number;
  completed: number;
  preferenceDisabled: number;
  retried: number;
  deadLettered: number;
  leaseLost: number;
  pendingBacklog: number;
  deadLetterBacklog: number;
  pruned: number;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseClaim(value: unknown): ClaimedPublicMutationEffect | null {
  const row = asObject(value);
  if (!row) return null;
  const id = nonEmptyString(row.id);
  const tenantId = nonEmptyString(row.tenant_id);
  const leaseToken = nonEmptyString(row.lease_token);
  return id && tenantId && leaseToken ? { id, tenantId, leaseToken } : null;
}

function boundedLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.trunc(value), 100));
}

/**
 * Materializes durable public-mutation notifications in bounded, leased jobs.
 * Audit repair, notification insert and completion happen in one database RPC;
 * a lost response therefore cannot create a duplicate on retry.
 */
export async function processPublicMutationOutbox(
  limit = 50,
): Promise<PublicMutationOutboxSummary> {
  const admin = createAdminClient();
  const safeLimit = boundedLimit(limit);

  const { data: prunedData, error: pruneError } = await admin.rpc(
    "prune_public_mutation_effects",
    { p_limit: 500 },
  );
  if (pruneError) {
    throw new Error(`public mutation retention failed: ${pruneError.code || "unknown"}`);
  }

  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_public_mutation_effects",
    {
      p_limit: safeLimit,
      p_lease_seconds: LEASE_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    },
  );
  if (claimError) {
    throw new Error(`public mutation claim failed: ${claimError.code || "unknown"}`);
  }

  const rawJobs = Array.isArray(claimData) ? claimData : [];
  const jobs = rawJobs.map(parseClaim);
  if (jobs.some((job) => job === null)) {
    throw new Error("public mutation claim returned an invalid lease");
  }

  const summary: PublicMutationOutboxSummary = {
    claimed: jobs.length,
    completed: 0,
    preferenceDisabled: 0,
    retried: 0,
    deadLettered: 0,
    leaseLost: 0,
    pendingBacklog: 0,
    deadLetterBacklog: 0,
    pruned: Number(prunedData ?? 0),
  };

  for (const job of jobs as ClaimedPublicMutationEffect[]) {
    const { data: completionData, error: completionError } = await admin.rpc(
      "complete_public_mutation_effect",
      {
        p_id: job.id,
        p_tenant_id: job.tenantId,
        p_lease_token: job.leaseToken,
      },
    );

    if (!completionError) {
      const completion = asObject(completionData);
      if (completion?.state === "dead_letter") {
        summary.deadLettered += 1;
      } else if (completion?.applied === true) {
        summary.completed += 1;
        if (completion.reason === "preference_disabled") summary.preferenceDisabled += 1;
      } else {
        summary.leaseLost += 1;
      }
      continue;
    }

    console.error("public mutation completion failed", {
      jobId: job.id,
      code: completionError.code || "unknown",
    });
    const { data: failureData, error: failureError } = await admin.rpc(
      "fail_public_mutation_effect",
      {
        p_id: job.id,
        p_tenant_id: job.tenantId,
        p_lease_token: job.leaseToken,
        p_error_code: "completion_rpc_failed",
        p_max_attempts: MAX_ATTEMPTS,
      },
    );
    if (failureError) {
      throw new Error(`public mutation retry failed: ${failureError.code || "unknown"}`);
    }

    const failure = asObject(failureData);
    if (failure?.applied !== true) summary.leaseLost += 1;
    else if (failure.state === "dead_letter") summary.deadLettered += 1;
    else summary.retried += 1;
  }

  const [pendingResult, deadLetterResult] = await Promise.all([
    admin
      .from("public_mutation_outbox")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "retry"]),
    admin
      .from("public_mutation_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter"),
  ]);
  if (pendingResult.error || deadLetterResult.error) {
    throw new Error(
      `public mutation backlog lookup failed: ${pendingResult.error?.code || deadLetterResult.error?.code || "unknown"}`,
    );
  }
  summary.pendingBacklog = pendingResult.count ?? 0;
  summary.deadLetterBacklog = deadLetterResult.count ?? 0;
  return summary;
}
