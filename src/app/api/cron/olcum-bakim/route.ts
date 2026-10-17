import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";
import { runMeasureMaintenance } from "@/lib/measure/maintenance";
import { runZekaIndex } from "@/lib/ai/zeka/knowledge/index-job";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ölçüm bakımı (günlük 02:40 UTC): aynı süreçteki beacon tamponunu boşaltır, ardından eski sayaçları budar
 * (`analytics_prune`: sayfa sayaçları 400 gün, hız histogramı 90 gün). Tablo yoksa iş "atlandı" olarak biter.
 * İkinci adım: EmlakSoft Zeka anlamsal dizini (`runZekaIndex`; OpenAI anahtarı yoksa atlanır, yalnız değişen parçalar gömülür).
 * Zeka adımının hatası ölçüm bakımını bozmaz; nabız ayrıntısına yazılır.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("olcum-bakim", req);
  if (pausedRun) return pausedRun;

  try {
    const r = await runMeasureMaintenance();
    const zeka = await runZekaIndex().catch(() => ({ status: "error" as const, detail: "zeka dizini çalışmadı", embedded: 0, total: 0 }));
    const failed = r.failed + (zeka.status === "error" ? 1 : 0);
    await recordHeartbeat("olcum-bakim", heartbeatFor({ failed }), `${r.detail} · Zeka dizini: ${zeka.detail}`);
    return NextResponse.json({ ok: failed === 0, ...r, zeka });
  } catch (error) {
    log.error("cron_olcum_bakim_failed", { route: "/api/cron/olcum-bakim", ...errorFields(error) });
    await recordHeartbeat("olcum-bakim", "error", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false, error: "olcum_bakim_failed" }, { status: 500 });
  }
}
