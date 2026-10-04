import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { runPoolSweep } from "@/lib/pool/system-assign";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * İlan havuzu süpürmesi (10 dakikada bir): süresi dolan sahiplenmeyi yedek zincire/yönetime aktarır,
 * auto modda eşiği geçen ilanı atar, SLA'sı geçeni uyarır. Havuz tabloları yoksa (migration uygulanmamış) sessizce 0 işler.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const summary = await runPoolSweep(createAdminClient());
    await recordHeartbeat(
      "havuz-atama",
      "ok",
      `${summary.examined} kayıt, ${summary.autoAssigned} otomatik, ${summary.fallbackAssigned} yedek, ${summary.escalated} yükseltme, ${summary.slaBreached} SLA`,
    );
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("cron havuz-atama", err);
    await recordHeartbeat("havuz-atama", "error", "süpürme başarısız");
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
