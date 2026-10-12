import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueStorageDeletion } from "@/lib/storage-deletion-outbox";

/** İmzalı yükleme belirteci 2 saat geçerli; ek tampon ile 3 saat sonra yarım yüklemeler sahipsiz sayılır. */
export const ABANDONED_UPLOAD_AFTER_MS = 3 * 60 * 60 * 1000;

export type PublicUploadCleanupSummary = {
  rentReceiptsQueued: number;
  docRequestFilesQueued: number;
  failed: number;
};

const BATCH = 100;

/**
 * Herkese açık (token'lı) yüklemelerde prepare edilip finalize edilmemiş yetim nesneler:
 * - kira dekontu (rent-receipts): bildirim satırındaki dekont alanları boşaltılır; nesne kalıcı silme kuyruğuna düşer.
 * - evrak linki dosyası (customer-files / document_request_files): nesne kuyruğa düşer, bekleyen satır silinir.
 * Her adım ayrı try/catch; biri hata verirse öbürü çalışır. Silme kuyruğu işçisi nesnenin güncel
 * meta kaydında olup olmadığına bakar; doğrulanmış dosyaya asla dokunulmaz (yalnız pending/blocked taranır).
 */
export async function cleanupAbandonedPublicUploads(nowMs: number): Promise<PublicUploadCleanupSummary> {
  const admin = createAdminClient();
  const cutoff = new Date(nowMs - ABANDONED_UPLOAD_AFTER_MS).toISOString();
  const summary: PublicUploadCleanupSummary = { rentReceiptsQueued: 0, docRequestFilesQueued: 0, failed: 0 };

  try {
    const { data, error } = await admin
      .from("rent_payment_notices")
      .select("id, tenant_id, customer_id, receipt_path")
      .in("receipt_status", ["pending", "blocked"])
      .lt("receipt_prepared_at", cutoff)
      .limit(BATCH);
    if (error) throw new Error(`rent receipt stale query failed: ${error.code}`);
    for (const row of data ?? []) {
      try {
        // Tetikleyici de aynı işi yapar; migration öncesi güvenli olsun diye açıkça kuyruğa atılır (idempotent upsert).
        if (row.receipt_path) {
          await enqueueStorageDeletion({
            tenantId: row.tenant_id,
            parentId: row.customer_id,
            bucket: "rent-receipts",
            objectPath: row.receipt_path,
            sourceTable: "rent_payment_notices",
            sourceId: row.id,
            reason: "rent_receipt_upload_not_finalized",
          });
        }
        const { error: clearError } = await admin
          .from("rent_payment_notices")
          .update({
            receipt_path: null,
            receipt_name: null,
            receipt_mime: null,
            receipt_size: null,
            receipt_status: null,
            receipt_prepared_at: null,
          })
          .eq("id", row.id)
          .eq("tenant_id", row.tenant_id)
          .eq("receipt_path", row.receipt_path ?? "")
          .in("receipt_status", ["pending", "blocked"]);
        if (clearError) throw new Error(`rent receipt clear failed: ${clearError.code}`);
        summary.rentReceiptsQueued += 1;
      } catch (err) {
        console.error("cleanupAbandonedPublicUploads rent", { id: row.id, error: err instanceof Error ? err.message : "unknown" });
        summary.failed += 1;
      }
    }
  } catch (err) {
    console.error("cleanupAbandonedPublicUploads rent query", { error: err instanceof Error ? err.message : "unknown" });
    summary.failed += 1;
  }

  try {
    const { data, error } = await admin
      .from("document_request_files")
      .select("id, tenant_id, request_id, storage_path")
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .limit(BATCH);
    if (error) throw new Error(`doc request stale query failed: ${error.code}`);
    for (const row of data ?? []) {
      try {
        await enqueueStorageDeletion({
          tenantId: row.tenant_id,
          parentId: row.request_id,
          bucket: "customer-files",
          objectPath: row.storage_path,
          sourceTable: "document_request_files",
          sourceId: row.id,
          reason: "doc_request_upload_not_finalized",
        });
        const { error: deleteError } = await admin
          .from("document_request_files")
          .delete()
          .eq("id", row.id)
          .eq("tenant_id", row.tenant_id)
          .eq("status", "pending");
        if (deleteError) throw new Error(`doc request file delete failed: ${deleteError.code}`);
        summary.docRequestFilesQueued += 1;
      } catch (err) {
        console.error("cleanupAbandonedPublicUploads doc", { id: row.id, error: err instanceof Error ? err.message : "unknown" });
        summary.failed += 1;
      }
    }
  } catch (err) {
    console.error("cleanupAbandonedPublicUploads doc query", { error: err instanceof Error ? err.message : "unknown" });
    summary.failed += 1;
  }

  return summary;
}
