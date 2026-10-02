import "server-only";

import { randomUUID } from "node:crypto";
import { externalErrorMetadata } from "@/lib/external-fetch";
import {
  fetchGeoProvinceSnapshot,
  GeoProviderContractError,
} from "@/lib/geo-provider";
import { createAdminClient } from "@/lib/supabase/admin";

type ClaimedGeoSyncJob = {
  id: string;
  provinceId: string;
  leaseToken: string;
};

export type GeoProvinceSyncWorkerSummary = {
  claimed: number;
  provinceId: string | null;
  plateCode: number | null;
  outcome: "idle" | "succeeded" | "partial" | "paused" | "retry" | "dead_letter" | "lease_lost";
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: number;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return objectValue(value[0]);
  return objectValue(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseClaim(value: unknown): ClaimedGeoSyncJob | null {
  const row = firstRow(value);
  if (!row) return null;
  const id = nonEmptyString(row.id);
  const provinceId = nonEmptyString(row.province_id);
  const leaseToken = nonEmptyString(row.lease_token);
  if (!id || !provinceId || !leaseToken) return null;
  return { id, provinceId, leaseToken };
}

function resultCount(result: Record<string, unknown> | null, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(result?.[key]);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return 0;
}

function retryableDatabaseCode(code: string | undefined): boolean {
  return Boolean(code && (
    code.startsWith("08")
    || code === "40001"
    || code === "40P01"
    || code === "55P03"
    || code === "57014"
  ));
}

function fetchFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof GeoProviderContractError) {
    return { code: error.code.slice(0, 80), retryable: false };
  }
  if (error instanceof RangeError) return { code: "invalid_plate_code", retryable: false };
  const metadata = externalErrorMetadata(error);
  if (metadata.kind === "http") {
    return {
      code: `provider_http_${metadata.status ?? "unknown"}`,
      retryable: metadata.status === 408 || metadata.status === 429 || (metadata.status ?? 0) >= 500,
    };
  }
  if (metadata.kind === "invalid_response" || metadata.kind === "response_too_large") {
    return { code: `provider_${metadata.kind}`, retryable: false };
  }
  return { code: `provider_${metadata.kind}`, retryable: true };
}

async function failClaimedJob(
  job: ClaimedGeoSyncJob,
  code: string,
  retryable: boolean,
): Promise<"paused" | "retry" | "dead_letter" | "lease_lost"> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_geo_sync_job", {
    p_job_id: job.id,
    p_lease_token: job.leaseToken,
    p_error_code: code.slice(0, 80),
    p_retryable: retryable,
  });
  if (error) throw new Error(`geo sync failure transition failed: ${error.code || "unknown"}`);
  const result = firstRow(data);
  if (result?.applied === false) return "lease_lost";
  if (result?.status === "paused") return "paused";
  return result?.status === "retry" ? "retry" : "dead_letter";
}

/** Claims and processes at most one province so a serverless run stays bounded. */
export async function runGeoProvinceSyncWorker(): Promise<GeoProvinceSyncWorkerSummary> {
  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc("claim_geo_sync_job", {
    p_worker_id: randomUUID(),
    p_lease_minutes: 2,
  });
  if (claimError) throw new Error(`geo sync claim failed: ${claimError.code || "unknown"}`);

  const rawClaim = firstRow(claimData);
  if (!rawClaim) {
    return {
      claimed: 0,
      provinceId: null,
      plateCode: null,
      outcome: "idle",
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }
  const job = parseClaim(rawClaim);
  if (!job) throw new Error("geo sync claim returned an invalid lease");

  const { data: province, error: provinceError } = await admin
    .from("geo_provinces")
    .select("plate_code")
    .eq("id", job.provinceId)
    .maybeSingle();
  const plateCode = Number(province?.plate_code);
  if (provinceError || !Number.isInteger(plateCode) || plateCode < 1 || plateCode > 81) {
    const outcome = await failClaimedJob(
      job,
      "province_lookup_failed",
      retryableDatabaseCode(provinceError?.code),
    );
    return {
      claimed: 1,
      provinceId: job.provinceId,
      plateCode: null,
      outcome,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }

  let snapshot;
  try {
    snapshot = await fetchGeoProvinceSnapshot(plateCode);
  } catch (error) {
    const failure = fetchFailure(error);
    const outcome = await failClaimedJob(job, failure.code, failure.retryable);
    return {
      claimed: 1,
      provinceId: job.provinceId,
      plateCode,
      outcome,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }

  const { data: applyData, error: applyError } = await admin.rpc("apply_geo_province_sync", {
    p_job_id: job.id,
    p_lease_token: job.leaseToken,
    p_payload: snapshot.payload,
    p_source_version: snapshot.sourceVersion,
    p_source_last_updated: snapshot.sourceLastUpdated,
    p_source_hash: snapshot.sourceHash,
  });
  if (applyError) {
    const outcome = await failClaimedJob(
      job,
      "apply_rpc_failed",
      retryableDatabaseCode(applyError.code),
    );
    return {
      claimed: 1,
      provinceId: job.provinceId,
      plateCode,
      outcome,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }

  const result = firstRow(applyData);
  if (!result) {
    const outcome = await failClaimedJob(job, "apply_result_invalid", false);
    return {
      claimed: 1,
      provinceId: job.provinceId,
      plateCode,
      outcome,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }
  if (result?.applied === false) {
    return {
      claimed: 1,
      provinceId: job.provinceId,
      plateCode,
      outcome: "lease_lost",
      inserted: 0,
      updated: 0,
      unchanged: 0,
      conflicts: 0,
    };
  }
  return {
    claimed: 1,
    provinceId: job.provinceId,
    plateCode,
    outcome: result.status === "partial" ? "partial" : "succeeded",
    inserted: resultCount(result, "insertedCount", "inserted_count", "inserted"),
    updated: resultCount(result, "updatedCount", "updated_count", "updated"),
    unchanged: resultCount(result, "unchangedCount", "unchanged_count", "unchanged"),
    conflicts: resultCount(result, "conflictCount", "conflict_count", "conflicts"),
  };
}
