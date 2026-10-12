import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { processStorageDeletionOutbox, storageDeletionQueueStats } from "@/lib/storage-deletion-outbox";
import { purgeExpiredScopeOverrides } from "@/lib/access-control/expire-overrides";
import { now } from "@/lib/clock";
import { authorizeCron } from "@/lib/cron-auth";
import { cronStepsFailed, runCronSteps } from "@/lib/cron-steps";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // Retention RPC'si, depo silme kuyruğu ve kapsam istisnası temizliği BAĞIMSIZ adımlardır:
  // biri hata verince öbürleri yine çalışır; hatalar adıyla heartbeat'e yazılır.
  const outcome = await runCronSteps({
    retention: async () => {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("run_operational_retention");
      if (error) throw new Error(`retention rpc failed: ${error.code}`);
      return data;
    },
    storage: () => processStorageDeletionOutbox(100),
    // Süresi 90+ gün önce dolan kapsam istisnaları (yetkilendirme) silinir; tablo yoksa atlanır. İdempotent.
    scopeOverrides: () => purgeExpiredScopeOverrides(createAdminClient(), { nowMs: now() }),
  });
  const queue = await storageDeletionQueueStats().catch(() => null);
  const failed = cronStepsFailed(outcome);
  const detail = JSON.stringify({ ...outcome.results, queue, errors: outcome.errors });
  await recordHeartbeat("operational-retention", failed ? "error" : "ok", detail);
  if (failed) {
    return NextResponse.json({ ok: false, error: "operational_retention_failed", failedSteps: Object.keys(outcome.errors) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...outcome.results, queue });
}
