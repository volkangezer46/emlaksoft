import { NextRequest, NextResponse } from "next/server";
import { now } from "@/lib/clock";
import { authorizeCron } from "@/lib/cron-auth";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";
import { guardCron } from "@/lib/cron-run";
import {
  lastAdsDay,
  lastGscDay,
  platformSettingsPort,
  pruneGoogleData,
  readInspectionIndex,
  upsertAdsRows,
  upsertGscRows,
  upsertInspection,
} from "@/lib/google/db";
import { runGoogleSync, syncSummary } from "@/lib/google/sync";

/**
 * GOOGLE SENKRON (günlük 03:10 UTC). Bağlantı yokken de kurulu: "atlandı: bağlı değil" yazar ve HİÇBİR dış çağrı yapmaz;
 * sahip bağlandığı gece veri akışı kendiliğinden başlar (yeniden dağıtım gerekmez). Bağlıysa Search Console analitiği,
 * URL Inspection (günde ≤50) ve Google Ads (yalnız okuma) çekilir, ardından budama (GSC 16 ay, Ads 25 ay).
 * Hizmetler birbirinden yalıtılır; adım hataları heartbeat detayına yazılır ve durumu "error" yapar.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const outcome = await runGoogleSync({
    port: platformSettingsPort,
    nowMs: now,
    store: {
      lastGscDay,
      lastAdsDay,
      upsertGscRows,
      upsertAdsRows,
      readInspectionIndex,
      upsertInspection,
      prune: pruneGoogleData,
    },
  });

  if (outcome.skipped) {
    await recordHeartbeat("google-senkron", "ok", `atlandı: ${outcome.reason}`);
    return NextResponse.json({ ok: true, skipped: true, reason: outcome.reason });
  }

  await recordHeartbeat("google-senkron", heartbeatFor({ failed: outcome.failed }), syncSummary(outcome));
  return NextResponse.json({ ok: outcome.failed === 0, failed: outcome.failed, reconnect: outcome.reconnect });
}

export const GET = guardCron("google-senkron", run);
