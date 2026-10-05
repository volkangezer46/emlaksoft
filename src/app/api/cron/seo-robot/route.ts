import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { executeSeoRobot } from "@/lib/seo/robot";
import { authorizeCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SEO robotu (günlük). Kendi sitemap'indeki adresleri kendi sunucusundan denetler (harici site YOK),
 * sonucu platform ayarlarına yazar, açıksa IndexNow'a bildirir, eşik aşılırsa platform personeline bildirim atar.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const { run, indexNow, notified } = await executeSeoRobot("cron");
    const s = run.summary;
    await recordHeartbeat(
      "seo-robot",
      "ok",
      `${s.pagesChecked} sayfa, ${s.critical} kritik, ${s.warning} uyarı; IndexNow: ${indexNow.sent} URL (${indexNow.status})`,
    );
    return NextResponse.json({ ok: true, summary: s, indexNow, notified });
  } catch (error) {
    console.error("cron seo-robot", error);
    await recordHeartbeat("seo-robot", "error", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false, error: "seo_robot_failed" }, { status: 500 });
  }
}
