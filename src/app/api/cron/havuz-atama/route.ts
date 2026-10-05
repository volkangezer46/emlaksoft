import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { runPoolSweep } from "@/lib/pool/system-assign";
import { authorizeCron } from "@/lib/cron-auth";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

/**
 * İlan havuzu süpürmesi (10 dakikada bir): süresi dolan sahiplenmeyi yedek zincire/yönetime aktarır,
 * auto modda eşiği geçen ilanı atar, SLA'sı geçeni uyarır. Havuz tabloları yoksa (migration uygulanmamış) sessizce 0 işler.
 */
export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;
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
