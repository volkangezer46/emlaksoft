import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { cleanupDirectFileUploads } from "@/lib/direct-file-upload-cleanup";
import { cleanupAbandonedPublicUploads } from "@/lib/public-upload-cleanup";
import { processStorageDeletionOutbox, storageDeletionQueueStats } from "@/lib/storage-deletion-outbox";
import { cronStepsFailed, runCronSteps } from "@/lib/cron-steps";
import { now } from "@/lib/clock";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Her 30 dk: (1) oturumlu yüklemelerin yetim temizliği, (2) herkese açık dekont/evrak yarım yüklemeleri,
 * (3) depo silme kuyruğu işleme. Adımlar bağımsızdır; biri hata verirse öbürleri yine çalışır.
 */
export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const pausedRun = await beginCronRun("direct-file-upload-cleanup", request);
  if (pausedRun) return pausedRun;

  const outcome = await runCronSteps({
    directUploads: () => cleanupDirectFileUploads(),
    publicUploads: () => cleanupAbandonedPublicUploads(now()),
    storageOutbox: () => processStorageDeletionOutbox(100),
  });
  // Sayaçlar (kuyruk derinliği / başarısız) izleme içindir; okunamazsa işi bozmaz.
  const queue = await storageDeletionQueueStats().catch(() => null);
  const failed = cronStepsFailed(outcome);
  const detail = JSON.stringify({ ...outcome.results, queue, errors: outcome.errors });
  await recordHeartbeat("direct-file-upload-cleanup", failed ? "error" : "ok", detail);
  if (failed) {
    return NextResponse.json({ ok: false, error: "direct_file_upload_cleanup_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, summary: outcome.results.directUploads, publicUploads: outcome.results.publicUploads, storage: outcome.results.storageOutbox, queue });
}
