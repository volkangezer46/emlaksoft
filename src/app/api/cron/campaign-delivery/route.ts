import { NextRequest, NextResponse } from "next/server";
import { runCampaignDeliveryWorker } from "@/lib/campaign-delivery";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runCampaignDeliveryWorker({
      campaignLimit: 3,
      recipientBatchSize: 10,
    });
    const healthy = summary.campaignFailures === 0;
    await recordHeartbeat(
      "campaign-delivery",
      healthy ? "ok" : "error",
      JSON.stringify(summary),
    );
    return NextResponse.json(
      { ok: healthy, summary },
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
