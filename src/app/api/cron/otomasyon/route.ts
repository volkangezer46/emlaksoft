import { NextRequest, NextResponse } from "next/server";
import { runScheduledAutomations } from "@/lib/automation-engine";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { cronDeadline, heartbeatFor } from "@/lib/cron-run";

/** Zaman tabanlı otomasyonları çalıştırır (auth_expiring, demand_stale, no_contact_days, appointment_missed). */
/** Uzun süren toplu işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const summary = await runScheduledAutomations({ deadlineMs: cronDeadline(Date.now()) });

  const hb = heartbeatFor({
    total: summary.automationsEvaluated,
    processed: summary.automationsEvaluated,
    failed: summary.automationsFailed,
    timedOut: summary.timedOut,
    summary: `${summary.actionsExecuted} aksiyon çalıştı`,
  });
  await recordHeartbeat("otomasyon", hb.status, hb.detail);

  return NextResponse.json({
    ok: hb.status === "ok",
    failed: summary.automationsFailed,
    timedOut: summary.timedOut,
    evaluated: summary.automationsEvaluated,
    matched: summary.entitiesMatched,
    actions: summary.actionsExecuted,
    skipped: summary.skippedDuplicates,
  });
}
