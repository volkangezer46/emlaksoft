import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";
import { runMeasureMaintenance } from "@/lib/measure/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ölçüm bakımı (günlük 02:40 UTC): aynı süreçteki beacon tamponunu boşaltır, ardından eski sayaçları budar
 * (`analytics_prune`: sayfa sayaçları 400 gün, hız histogramı 90 gün). Tablo yoksa iş "atlandı" olarak biter.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("olcum-bakim", req);
  if (pausedRun) return pausedRun;

  try {
    const r = await runMeasureMaintenance();
    await recordHeartbeat("olcum-bakim", heartbeatFor({ failed: r.failed }), r.detail);
    return NextResponse.json({ ok: r.failed === 0, ...r });
  } catch (error) {
    console.error("cron olcum-bakim", error);
    await recordHeartbeat("olcum-bakim", "error", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false, error: "olcum_bakim_failed" }, { status: 500 });
  }
}
