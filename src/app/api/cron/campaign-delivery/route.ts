import { NextRequest, NextResponse } from "next/server";
import { runCampaignDeliveryWorker } from "@/lib/campaign-delivery";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { runAnnouncementQueue } from "@/lib/platform-announcements/run";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    // AYRIK ADIM (AD8): platform duyuru kuyruğu. Kampanya işinden ÖNCE ve bağımsız çalışır (asla fırlatmaz,
    // kendi süre bütçesi var); kampanya işi çökse de zamanlanmış duyurular 2 dk içinde gider.
    const announcements = await runAnnouncementQueue();
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
    console.error("campaign-delivery cron", detail);
    await recordHeartbeat("campaign-delivery", "error", detail);
    return NextResponse.json(
      { ok: false, error: "campaign_delivery_failed" },
      { status: 500 },
    );
  }
}
