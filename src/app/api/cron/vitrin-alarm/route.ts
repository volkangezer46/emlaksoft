import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { getDisabledModulesByTenant, skippedTenantsNote, tenantsDisabledFor } from "@/lib/modules/state";
import { processVitrinPriceAlerts } from "@/lib/vitrin-alert-notify";
import { authorizeCron } from "@/lib/cron-auth";
import { beginCronRun } from "@/lib/cron-pause";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/**
 * Vitrin fiyat alarmı cron'u (günlük 10:30 — vercel.json).
 *
 * Bekleyen vitrin_price_alerts kayıtlarında güncel liste fiyatı baseline'ın
 * altına düştüyse OFİSE "ziyaretçiyi arayın" bildirimi yazar (SMS yok) ve
 * notified_at doldurur. Asıl iş lib/vitrin-alert-notify.ts'te — saf helper,
 * vitrin-eslesme cron'una BİLEREK eklenmedi (ayrı sorumluluk, ayrı kalp atışı).
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const pausedRun = await beginCronRun("vitrin-alarm", req);
  if (pausedRun) return pausedRun;

  try {
    const admin = createAdminClient();
    const disabledModules = await getDisabledModulesByTenant(admin);
    const result = await processVitrinPriceAlerts(admin, new Set(tenantsDisabledFor(disabledModules, "vitrin")));
    const note = skippedTenantsNote(disabledModules, "vitrin");
    await recordHeartbeat(
      "vitrin-alarm",
      "ok",
      (result.pending === 0 ? "bekleyen alarm yok" : `${result.pending} alarm tarandı, ${result.notified} bildirim`) + note,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    log.error("cron_vitrin_alarm_failed", { route: "/api/cron/vitrin-alarm", ...errorFields(e) });
    await recordHeartbeat("vitrin-alarm", "error", e instanceof Error ? e.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
