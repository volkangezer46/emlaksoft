import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { processVitrinPriceAlerts } from "@/lib/vitrin-alert-notify";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Vitrin fiyat alarmı cron'u (günlük 10:30 — vercel.json).
 *
 * Bekleyen vitrin_price_alerts kayıtlarında güncel liste fiyatı baseline'ın
 * altına düştüyse OFİSE "ziyaretçiyi arayın" bildirimi yazar (SMS yok) ve
 * notified_at doldurur. Asıl iş lib/vitrin-alert-notify.ts'te — saf helper,
 * vitrin-eslesme cron'una BİLEREK eklenmedi (ayrı sorumluluk, ayrı kalp atışı).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const result = await processVitrinPriceAlerts(admin);
    await recordHeartbeat(
      "vitrin-alarm",
      "ok",
      result.pending === 0 ? "bekleyen alarm yok" : `${result.pending} alarm tarandı, ${result.notified} bildirim`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("cron vitrin-alarm", e);
    await recordHeartbeat("vitrin-alarm", "error", e instanceof Error ? e.message : "bilinmeyen hata");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
