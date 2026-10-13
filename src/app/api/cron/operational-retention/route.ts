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
import { ERRORS_AUTO_RESOLVE_DAYS_KEY } from "@/lib/settings/registry/platform";
import { getSettings } from "@/lib/settings/read";
import { autoResolveCutoffIso } from "@/lib/errors/classify";
import { runPortalLearningRetention, runPortalRulesLearn } from "@/lib/portal-rules/server/learn-step";

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
    // Hata gürültüsü: N gündür (ayar errors.auto_resolve_days, varsayılan 14) görülmeyen açık hata türleri kapanır.
    // Hata yeniden görülürse record_error_occurrence yeni AÇIK satır açar (çakışma dizini yalnız açık satırlarda).
    // Kapanan sayı heartbeat notuna (`errorsAutoResolve.closed`) düşer. İdempotent.
    errorsAutoResolve: async () => {
      const days = Number((await getSettings([ERRORS_AUTO_RESOLVE_DAYS_KEY]))[ERRORS_AUTO_RESOLVE_DAYS_KEY] ?? 14);
      const { data, error } = await getAdmin()
        .from("error_logs")
        .update({ resolved_at: new Date(now()).toISOString() })
        .is("resolved_at", null)
        .lt("last_seen", autoResolveCutoffIso(now(), days))
        .select("id");
      if (error) throw new Error(`error auto-resolve failed: ${error.code}`);
      return { days, closed: (data ?? []).length };
    },
    // Öğrenen eklenti kuralları: oylar/öneriler/katalog; otomatik yayın yalnız portal_rules.auto_* açıksa (varsayılan kapalı).
    // Tablo/fonksiyon yoksa 'skipped'. Aynı tembel servis istemcisi.
    portalRulesLearn: () => runPortalRulesLearn(getAdmin(), { nowMs: now() }),
    // Gözlem saklama süreleri (olay 180, rapor 90, oy 180 gün; katalog 1 yıl). İdempotent.
    portalLearningRetention: () => runPortalLearningRetention(getAdmin(), { nowMs: now() }),
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
