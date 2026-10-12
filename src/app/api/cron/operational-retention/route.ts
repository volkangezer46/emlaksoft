import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { processStorageDeletionOutbox, storageDeletionQueueStats } from "@/lib/storage-deletion-outbox";
import { purgeExpiredScopeOverrides } from "@/lib/access-control/expire-overrides";
import { now } from "@/lib/clock";
import { authorizeCron } from "@/lib/cron-auth";
import { cronStepsFailed, runCronSteps } from "@/lib/cron-steps";
import { clampRetentionDays, purgeExpiredFsboPii } from "@/lib/prospecting/retention";
import { readTenantSettings } from "@/lib/settings/tenant-read";
import { FSBO_RETENTION_DAYS_KEY } from "@/lib/settings/registry/tenant";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  // Retention RPC'si, depo silme kuyruğu ve kapsam istisnası temizliği BAĞIMSIZ adımlardır:
  // biri hata verince öbürleri yine çalışır; hatalar adıyla heartbeat'e yazılır.
  // Tek (tembel) servis istemcisi: admin-client kabul listesindeki kullanım sayısı artmaz.
  let cached: ReturnType<typeof createAdminClient> | null = null;
  const getAdmin = () => (cached ??= createAdminClient());
  const outcome = await runCronSteps({
    retention: async () => {
      const { data, error } = await getAdmin().rpc("run_operational_retention");
      if (error) throw new Error(`retention rpc failed: ${error.code}`);
      return data;
    },
    storage: () => processStorageDeletionOutbox(100),
    // Süresi 90+ gün önce dolan kapsam istisnaları (yetkilendirme) silinir; tablo yoksa atlanır. İdempotent.
    scopeOverrides: () => purgeExpiredScopeOverrides(getAdmin(), { nowMs: now() }),
    // Sahibinden ilanlar: saklama süresi (ofis ayarı 30-180 gün, varsayılan 90) dolan kayıtların ad/telefon/notu silinir. İdempotent.
    fsboPii: () => {
      const admin = getAdmin();
      return purgeExpiredFsboPii(admin, {
        nowMs: now(),
        retentionFor: async (tenantId) => {
          const values = await readTenantSettings(admin, tenantId, [FSBO_RETENTION_DAYS_KEY]);
          return clampRetentionDays(values[FSBO_RETENTION_DAYS_KEY]);
        },
      });
    },
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
