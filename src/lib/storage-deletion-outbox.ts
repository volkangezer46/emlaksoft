import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSafeStorageDeletionPath,
  publicUrlReferencesStorageObject,
} from "@/lib/storage-deletion-policy";

type StorageDeletionJob = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  parent_id: string | null;
  bucket: string;
  object_path: string;
  source_table: string;
  source_id: string | null;
  attempt_count: number;
};

export type StorageDeletionSummary = {
  claimed: number;
  completed: number;
  retained: number;
  retried: number;
  failed: number;
};

const MAX_ATTEMPTS = 10;

export type EnqueueStorageDeletionInput = {
  tenantId: string;
  parentId: string | null;
  bucket: string;
  objectPath: string;
  sourceTable: string;
  sourceId?: string | null;
  reason: string;
};

function safeObjectPath(job: StorageDeletionJob): boolean {
  return isSafeStorageDeletionPath({
    tenantId: job.tenant_id,
    parentId: job.parent_id ?? job.customer_id,
    bucket: job.bucket,
    objectPath: job.object_path,
  });
}

/** Queue cleanup for an uploaded object whose metadata transaction failed. */
export async function enqueueStorageDeletion(
  input: EnqueueStorageDeletionInput,
): Promise<void> {
  if (
    !isSafeStorageDeletionPath({
      tenantId: input.tenantId,
      parentId: input.parentId,
      bucket: input.bucket,
      objectPath: input.objectPath,
    })
  ) {
    throw new Error("unsafe_or_unsupported_storage_path");
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from("storage_deletion_outbox").upsert(
    {
      tenant_id: input.tenantId,
      customer_id: input.bucket === "customer-files" ? input.parentId : null,
      parent_id: input.parentId,
      bucket: input.bucket,
      object_path: input.objectPath,
      source_table: input.sourceTable,
      source_id: input.sourceId ?? null,
      reason: input.reason,
      status: "pending",
      attempt_count: 0,
      next_attempt_at: now,
      last_attempt_at: null,
      last_error: null,
      completed_at: null,
      updated_at: now,
    },
    { onConflict: "bucket,object_path" },
  );
  if (error) throw new Error(`storage deletion enqueue failed: ${error.code}`);
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(24 * 60 * 60, 60 * 2 ** Math.max(0, attempt - 1));
}

function objectAlreadyMissing(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  const detail = `${error.statusCode ?? ""} ${error.message ?? ""}`.toLowerCase();
  return detail.includes("404") || detail.includes("not found") || detail.includes("does not exist");
}

async function currentMetadataReference(
  admin: ReturnType<typeof createAdminClient>,
  job: StorageDeletionJob,
): Promise<{ referenced: boolean; error: string | null }> {
  if (job.bucket === "customer-files" || job.bucket === "property-media" || job.bucket === "expense-receipts") {
    const table = job.bucket === "customer-files"
      ? "customer_files"
      : job.bucket === "expense-receipts"
        ? "expense_receipt_files"
        : "property_media";
    const { data, error } = await admin
      .from(table)
      .select("id")
      .eq("tenant_id", job.tenant_id)
      .eq("storage_path", job.object_path)
      .limit(1)
      .maybeSingle();
    if (error) return { referenced: false, error: `private_reference_check:${error.code}` };
    // A finalize response can be lost after metadata commits. Never remove a
    // private object while relational metadata still points to its exact key.
    return { referenced: Boolean(data), error: null };
  }

  if (job.bucket === "agent-photos") {
    const profileId = job.parent_id;
    if (!profileId) return { referenced: false, error: "missing_profile_parent" };
    const { data, error } = await admin
      .from("profiles")
      .select("photo_url")
      .eq("id", profileId)
      .eq("tenant_id", job.tenant_id)
      .maybeSingle();
    if (error) return { referenced: false, error: `profile_reference_check:${error.code}` };
    return {
      referenced: publicUrlReferencesStorageObject(
        data?.photo_url,
        "agent-photos",
        job.object_path,
      ),
      error: null,
    };
  }

  if (job.bucket === "tenant-logos") {
    const { data, error } = await admin
      .from("tenants")
      .select("logo_url")
      .eq("id", job.tenant_id)
      .maybeSingle();
    if (error) return { referenced: false, error: `tenant_reference_check:${error.code}` };
    return {
      referenced: publicUrlReferencesStorageObject(
        data?.logo_url,
        "tenant-logos",
        job.object_path,
      ),
      error: null,
    };
  }

  return { referenced: false, error: null };
}

export async function processStorageDeletionOutbox(limit = 50): Promise<StorageDeletionSummary> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_storage_deletion_jobs", {
    p_limit: Math.max(1, Math.min(100, Math.round(limit))),
  });
  if (error) throw new Error(`storage deletion claim failed: ${error.code}`);

  const jobs = (data ?? []) as StorageDeletionJob[];
  const summary: StorageDeletionSummary = {
    claimed: jobs.length,
    completed: 0,
    retained: 0,
    retried: 0,
    failed: 0,
  };

  for (const job of jobs) {
    let removalError: { message?: string; statusCode?: string | number } | null = null;
    let retained = false;
    if (!safeObjectPath(job)) {
      removalError = { message: "unsafe_or_unsupported_storage_path" };
    } else {
      const reference = await currentMetadataReference(admin, job);
      if (reference.error) {
        removalError = { message: reference.error };
      } else if (reference.referenced) {
        // A fixed public key may have been uploaded again after this job was
        // queued. The current metadata wins; never delete the replacement.
        retained = true;
      } else {
        const { error: storageError } = await admin.storage
          .from(job.bucket)
          .remove([job.object_path]);
        removalError = storageError;
      }
    }

    if (retained || !removalError || objectAlreadyMissing(removalError)) {
      const completedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("storage_deletion_outbox")
        .update({
          status: "completed",
          completed_at: completedAt,
          next_attempt_at: completedAt,
          last_error: null,
          updated_at: completedAt,
        })
        .eq("id", job.id)
        .eq("status", "processing");
      if (updateError) throw new Error(`storage deletion completion failed: ${updateError.code}`);
      summary.completed += 1;
      if (retained) summary.retained += 1;
      continue;
    }

    const terminal = job.attempt_count >= MAX_ATTEMPTS || !safeObjectPath(job);
    const nextAttempt = new Date(Date.now() + retryDelaySeconds(job.attempt_count) * 1_000).toISOString();
    const { error: updateError } = await admin
      .from("storage_deletion_outbox")
      .update({
        status: terminal ? "failed" : "retry",
        next_attempt_at: nextAttempt,
        last_error: String(removalError.message ?? "storage_remove_failed").slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "processing");
    if (updateError) throw new Error(`storage deletion retry update failed: ${updateError.code}`);
    if (terminal) summary.failed += 1;
    else summary.retried += 1;
  }

  return summary;
}
