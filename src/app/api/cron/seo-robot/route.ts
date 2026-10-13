import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { executeSeoRobot } from "@/lib/seo/robot";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { runNightlyKokpitNow, type NightlyOutcome } from "@/lib/site-issues/nightly";

export const dynamic = "force-dynamic";
/** Robot + Kokpit gece adımı (toplayıcılar, Otopilot, budama). Sunucu cron çağrısı 300 sn bekler. */
export const maxDuration = 300;

/**
 * SEO robotu (günlük). Ana sayfa + kendi sitemap'indeki adresleri ve iç bağlantılarla 2 seviye keşfedilen sayfaları kendi
 * sunucusundan denetler (harici site YOK),
 * sonucu platform ayarlarına yazar, açıksa IndexNow'a bildirir, eşik aşılırsa platform personeline bildirim atar.
 * Ardından YALITILMIŞ Kokpit adımı (src/lib/site-issues/nightly.ts): kuyruk bakımı (tüm toplayıcılar), Otopilot
 * (varsayılan KAPALI: kapalıyken yazma yok) ve site_issues budaması. Adımın hatası robotun sonucunu bozmaz; notu
 * heartbeat'e eklenir.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("seo-robot", req);
  if (pausedRun) return pausedRun;

  try {
    const { run, indexNow, notified } = await executeSeoRobot("cron");
    const s = run.summary;
    let kokpit: NightlyOutcome;
    try {
      kokpit = await runNightlyKokpitNow();
    } catch (e) {
      kokpit = { failed: 1, note: `Kokpit: adım çalışmadı (${e instanceof Error ? e.message.slice(0, 120) : "bilinmeyen hata"})` };
    }
    await recordHeartbeat(
      "seo-robot",
      "ok",
      `${s.pagesChecked} sayfa (${run.discovered ?? 0} keşif), ${s.critical} kritik, ${s.warning} uyarı; IndexNow: ${indexNow.sent} URL (${indexNow.status}); ${kokpit.note}`,
    );
    return NextResponse.json({ ok: true, summary: s, indexNow, notified, kokpit });
  } catch (error) {
    console.error("cron seo-robot", error);
    await recordHeartbeat("seo-robot", "error", error instanceof Error ? error.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false, error: "seo_robot_failed" }, { status: 500 });
  }
}
