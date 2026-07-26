import { NextRequest, NextResponse } from "next/server";
import { runScheduledAutomations } from "@/lib/automation-engine";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Zaman tabanlı otomasyonları çalıştırır (auth_expiring, demand_stale, no_contact_days, appointment_missed). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = await runScheduledAutomations();

  await recordHeartbeat("otomasyon", "ok", `${summary.actionsExecuted} aksiyon çalıştı`);

  return NextResponse.json({
    ok: true,
    evaluated: summary.automationsEvaluated,
    matched: summary.entitiesMatched,
    actions: summary.actionsExecuted,
    skipped: summary.skippedDuplicates,
  });
}
