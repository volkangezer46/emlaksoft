import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSafeDirectFileUploadPath,
  type DirectFileUploadKind,
} from "@/lib/direct-file-uploads";
import { enqueueStorageDeletion } from "@/lib/storage-deletion-outbox";

type CleanupSession = {
  id: string;
  tenant_id: string;
  kind: DirectFileUploadKind;
  customer_id: string | null;
  property_id: string | null;
  bucket: "customer-files" | "property-media";
  storage_path: string;
  canonical_extension: string;
  status: "pending" | "finalizing" | "blocked" | "expired" | "cleanup_queued";
  lease_id: string | null;
  lease_expires_at: string | null;
  cleanup_queued_at: string | null;
};

export type DirectFileUploadCleanupSummary = {
  scanned: number;
  cleanupQueued: number;
  metadataRepaired: number;
  skippedActiveLease: number;
  envelopesDeleted: number;
  failed: number;
};

async function metadataExists(session: CleanupSession) {
  const admin = createAdminClient();
  const table = session.kind === "customer_file" ? "customer_files" : "property_media";
  const parentColumn = session.kind === "customer_file" ? "customer_id" : "property_id";
  const parentId = session.customer_id ?? session.property_id;
  if (!parentId) return false;

  const { data, error } = await admin
    .from(table)
    .select("id, storage_path")
    .eq("tenant_id", session.tenant_id)
    .eq(parentColumn, parentId)
    .or(`id.eq.${session.id},storage_path.eq.${session.storage_path}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`direct upload metadata check failed: ${error.code}`);
  return Boolean(data);
}

/**
 * Converts abandoned/blocked sessions into durable outbox work only after
 * the two-hour provider write token plus a safety buffer has elapsed.
 */
export async function cleanupDirectFileUploads(
  now = new Date(),
  limit = 100,
): Promise<DirectFileUploadCleanupSummary> {
  const admin = createAdminClient();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 100, 250));
  const summary: DirectFileUploadCleanupSummary = {
    scanned: 0,
    cleanupQueued: 0,
    metadataRepaired: 0,
    skippedActiveLease: 0,
    envelopesDeleted: 0,
    failed: 0,
  };
  const nowIso = now.toISOString();

  const { data, error } = await admin
    .from("direct_file_uploads")
    .select(
      "id, tenant_id, kind, customer_id, property_id, bucket, storage_path, canonical_extension, status, lease_id, lease_expires_at, cleanup_queued_at",
    )
    .or(
      "status.in.(pending,finalizing,blocked,expired),and(status.eq.cleanup_queued,cleanup_queued_at.is.null)",
    )
    .lte("cleanup_after", nowIso)
    .order("cleanup_after", { ascending: true })
    .limit(boundedLimit);
  if (error) throw new Error(`direct upload cleanup query failed: ${error.code}`);

  for (const candidate of (data ?? []) as CleanupSession[]) {
    summary.scanned += 1;
    if (
      candidate.status === "finalizing" &&
      candidate.lease_expires_at &&
      new Date(candidate.lease_expires_at).getTime() > now.getTime()
    ) {
      summary.skippedActiveLease += 1;
      continue;
    }

    let session = candidate;
    if (candidate.status !== "cleanup_queued") {
      let claim = admin
        .from("direct_file_uploads")
        .update({
          status: "cleanup_queued",
          lease_id: null,
          lease_expires_at: null,
          blocked_reason: "cleanup_due_after_provider_token_expiry",
          updated_at: nowIso,
        })
        .eq("id", candidate.id)
        .eq("status", candidate.status);
      if (candidate.lease_id) claim = claim.eq("lease_id", candidate.lease_id);
      if (candidate.status === "finalizing") claim = claim.lte("lease_expires_at", nowIso);
      const { data: claimed, error: claimError } = await claim
        .select(
          "id, tenant_id, kind, customer_id, property_id, bucket, storage_path, canonical_extension, status, lease_id, lease_expires_at, cleanup_queued_at",
        )
        .maybeSingle();
      if (claimError) throw new Error(`direct upload cleanup claim failed: ${claimError.code}`);
      if (!claimed) continue;
      session = claimed as CleanupSession;
    }

    try {
      if (await metadataExists(session)) {
        const { error: repairError } = await admin
          .from("direct_file_uploads")
          .update({
            status: "finalized",
            lease_id: null,
            lease_expires_at: null,
            blocked_reason: null,
            finalized_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", session.id)
          .eq("status", "cleanup_queued");
        if (repairError) throw new Error(`direct upload repair failed: ${repairError.code}`);
        summary.metadataRepaired += 1;
        continue;
      }

      const parentId = session.customer_id ?? session.property_id;
      if (
        !parentId ||
        !isSafeDirectFileUploadPath({
          path: session.storage_path,
          tenantId: session.tenant_id,
          parentId,
          sessionId: session.id,
          extension: session.canonical_extension,
        })
      ) {
        summary.failed += 1;
        continue;
      }

      await enqueueStorageDeletion({
        tenantId: session.tenant_id,
        parentId,
        bucket: session.bucket,
        objectPath: session.storage_path,
        sourceTable: "direct_file_uploads",
        sourceId: session.id,
        reason: "signed_upload_not_finalized",
      });
      const { error: queuedError } = await admin
        .from("direct_file_uploads")
        .update({ cleanup_queued_at: nowIso, updated_at: nowIso })
        .eq("id", session.id)
        .eq("status", "cleanup_queued");
      if (queuedError) throw new Error(`direct upload cleanup marker failed: ${queuedError.code}`);
      summary.cleanupQueued += 1;
    } catch (cleanupError) {
      console.error("cleanupDirectFileUploads session", {
        sessionId: session.id,
        error: cleanupError instanceof Error ? cleanupError.message : "unknown",
      });
      summary.failed += 1;
    }
  }

  // Keep envelopes for seven days so finalize retries and incident review are
  // deterministic. cleanup_queued rows are deleted only after the outbox was
  // successfully persisted (cleanup_queued_at is non-null).
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: finalizedDeleted, error: finalizedDeleteError } = await admin
    .from("direct_file_uploads")
    .delete()
    .eq("status", "finalized")
    .lt("finalized_at", cutoff)
    .select("id");
  if (finalizedDeleteError) throw new Error(`direct upload finalized retention failed: ${finalizedDeleteError.code}`);
  const { data: cleanupDeleted, error: cleanupDeleteError } = await admin
    .from("direct_file_uploads")
    .delete()
    .eq("status", "cleanup_queued")
    .not("cleanup_queued_at", "is", null)
    .lt("cleanup_queued_at", cutoff)
    .select("id");
  if (cleanupDeleteError) throw new Error(`direct upload cleanup retention failed: ${cleanupDeleteError.code}`);
  summary.envelopesDeleted = (finalizedDeleted?.length ?? 0) + (cleanupDeleted?.length ?? 0);

  return summary;
}
