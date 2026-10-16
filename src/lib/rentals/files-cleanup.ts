import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueStorageDeletion } from "@/lib/storage-deletion-outbox";
import { ABANDONED_UPLOAD_AFTER_MS } from "@/lib/public-upload-cleanup";

export type RentalFilesCleanupSummary = { pendingQueued: number; purgedApplications: number; purgedFilesQueued: number; failed: number };

const BUCKET = "customer-files";
const BATCH = 100;
const isMissing = (code: string | undefined) => code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883";

/**
 * SP5/SP6 dosya temizliği (direct-file-upload-cleanup cron adımı):
 *  1) Kiracı başvurusu evrakı ve tutanak fotoğrafının yarım kalan (prepare edilip finalize edilmeyen) yüklemeleri: nesne
 *     silme kuyruğuna, satır "blocked". Doğrulanmış dosyaya dokunulmaz.
 *  2) KVKK saklama: retain_until geçmiş başvurular `rental_applications_purge_expired` ile silinir; dosyaları kuyruğa düşer
 *     (kuyruk işçisi customer-files için customer_files referansına bakar; bu tablolarda referans kalmadığı için silinir).
 * Tablolar yoksa (migration bekliyor) adım sessizce boş döner.
 */
export async function cleanupRentalFiles(nowMs: number): Promise<RentalFilesCleanupSummary> {
  const admin = createAdminClient();
  const cutoff = new Date(nowMs - ABANDONED_UPLOAD_AFTER_MS).toISOString();
  const summary: RentalFilesCleanupSummary = { pendingQueued: 0, purgedApplications: 0, purgedFilesQueued: 0, failed: 0 };

  const sources = [
    { table: "rental_application_files", parent: "application_id", reason: "rental_application_upload_not_finalized" },
    { table: "rental_inspection_photos", parent: "inspection_id", reason: "rental_inspection_upload_not_finalized" },
  ] as const;
  for (const src of sources) {
    const { data, error } = await admin
      .from(src.table)
      .select(`id, tenant_id, ${src.parent}, storage_path`)
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .limit(BATCH);
    if (error) {
      if (!isMissing(error.code)) {
        console.error("cleanupRentalFiles pending query", { table: src.table, code: error.code });
        summary.failed += 1;
      }
      continue;
    }
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      try {
        await enqueueStorageDeletion({
          tenantId: row.tenant_id!,
          parentId: row[src.parent] ?? null,
          bucket: BUCKET,
          objectPath: row.storage_path!,
          sourceTable: src.table,
          sourceId: row.id,
          reason: src.reason,
        });
        const { error: blockErr } = await admin.from(src.table).update({ status: "blocked" }).eq("id", row.id!).eq("status", "pending");
        if (blockErr) throw new Error(blockErr.code);
        summary.pendingQueued += 1;
      } catch (e) {
        console.error("cleanupRentalFiles pending", { table: src.table, error: e instanceof Error ? e.message : "unknown" });
        summary.failed += 1;
      }
    }
  }

  const { data: purged, error: purgeErr } = await admin.rpc("rental_applications_purge_expired", { p_limit: 200 });
  if (purgeErr) {
    if (!isMissing(purgeErr.code)) {
      console.error("cleanupRentalFiles purge", { code: purgeErr.code });
      summary.failed += 1;
    }
    return summary;
  }
  const rows = (purged ?? []) as { tenant_id: string; application_id: string; storage_path: string }[];
  summary.purgedApplications = new Set(rows.map((r) => r.application_id)).size;
  for (const r of rows) {
    try {
      await enqueueStorageDeletion({
        tenantId: r.tenant_id,
        parentId: r.application_id,
        bucket: BUCKET,
        objectPath: r.storage_path,
        sourceTable: "rental_application_files",
        sourceId: null,
        reason: "rental_application_retention_expired",
      });
      summary.purgedFilesQueued += 1;
    } catch (e) {
      console.error("cleanupRentalFiles purge enqueue", { error: e instanceof Error ? e.message : "unknown" });
      summary.failed += 1;
    }
  }
  return summary;
}
