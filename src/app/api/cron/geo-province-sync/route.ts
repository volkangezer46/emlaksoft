import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { runGeoProvinceSyncWorker } from "@/lib/geo-province-sync";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await runGeoProvinceSyncWorker();
    const healthy = !["partial", "retry", "dead_letter", "lease_lost"].includes(summary.outcome);
    if (summary.outcome === "partial" || summary.outcome === "dead_letter") {
      await notifyPlatformStaff({
        title: summary.outcome === "partial"
          ? "İl taraması manuel inceleme istiyor"
          : "İl taraması tamamlanamadı",
        body: summary.outcome === "partial"
          ? `${summary.plateCode ?? "-"} plakalı ilde ${summary.conflicts} kaynak kimliği çakışması korumaya alındı.`
          : `${summary.plateCode ?? "-"} plakalı il taraması güvenli biçimde durduruldu.`,
        href: "/admin/geo",
        kind: summary.outcome === "partial" ? "warning" : "danger",
        meta: {
          job: "geo-province-sync",
          provinceId: summary.provinceId,
          plateCode: summary.plateCode,
          outcome: summary.outcome,
          conflicts: summary.conflicts,
        },
      });
    }
    await recordHeartbeat(
      "geo-province-sync",
      healthy ? "ok" : "error",
      JSON.stringify(summary),
    );
    return NextResponse.json(
      { ok: healthy, summary },
      { status: healthy ? 200 : 500 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error("geo province sync cron", {
      error: error instanceof Error ? error.name : "unknown",
    });
    await recordHeartbeat("geo-province-sync", "error", detail);
    return NextResponse.json(
      { ok: false, error: "geo_province_sync_failed" },
      { status: 500 },
    );
  }
}
