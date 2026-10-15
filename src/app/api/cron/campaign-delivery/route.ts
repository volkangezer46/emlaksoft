import { NextRequest, NextResponse } from "next/server";
import { runCampaignDeliveryWorker } from "@/lib/campaign-delivery";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { runAnnouncementQueue } from "@/lib/platform-announcements/run";
import { log } from "@/lib/log";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;
  const pausedRun = await beginCronRun("campaign-delivery", request);
  if (pausedRun) return pausedRun;

  try {
    // AYRIK ADIM (AD8): platform duyuru kuyruğu. Kampanya işinden ÖNCE ve bağımsız çalışır (asla fırlatmaz,
    // kendi süre bütçesi var); kampanya işi çökse de zamanlanmış duyurular 2 dk içinde gider. Üst sınır 15 sn:
    // maxDuration=60 içinde kampanya işine süre kalır (kalan duyuru teslimi 2 dk sonraki turda sürer).
    const announcements = await runAnnouncementQueue({ maxBudgetMs: 15_000 });
    const summary = await runCampaignDeliveryWorker({
      campaignLimit: 3,
      recipientBatchSize: 10,
    });
    const healthy = summary.campaignFailures === 0;
    await recordHeartbeat(
      "campaign-delivery",
      healthy && !summary.quarantinedCampaigns && !announcements.error ? "ok" : "error",
      JSON.stringify({ ...summary, announcements }),
    );
    return NextResponse.json(
      { ok: healthy, summary, announcements },
      { status: healthy ? 200 : 500 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "campaign_delivery_failed";
    log.error("cron_campaign_delivery_failed", { route: "/api/cron/campaign-delivery", message: detail });
    await recordHeartbeat("campaign-delivery", "error", detail);
    return NextResponse.json(
      { ok: false, error: "campaign_delivery_failed" },
      { status: 500 },
    );
  }
}
