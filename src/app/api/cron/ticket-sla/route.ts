import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { runWaitingAutomation, type WaitingAutomationSummary } from "@/lib/support/waiting-automation";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("process_support_ticket_sla_escalations_v2", {
      p_limit: 200,
    });
    if (error) throw new Error(error.message);
    const summary = data && typeof data === "object" ? data : {};

    // AD9 ayrık adım: yanıt bekleyen bilet hatırlatma/otomatik kapanış. Hatası SLA adımını düşürmez.
    let waiting: WaitingAutomationSummary;
    try {
      waiting = await runWaitingAutomation(admin);
    } catch (stepError) {
      waiting = { ran: false, reason: "error", detail: stepError instanceof Error ? stepError.message : "unknown" };
    }
    if (!waiting.ran && waiting.reason === "error") console.error("ticket-sla waiting automation", waiting.detail);

    await recordHeartbeat("ticket-sla", "ok", JSON.stringify({ ...summary, waiting }));
    return NextResponse.json({ ok: true, summary, waiting });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Ticket gecikme escalation failed.";
    console.error("ticket-sla cron", detail);
    await recordHeartbeat("ticket-sla", "error", detail);
    return NextResponse.json({ ok: false, error: "ticket_sla_failed" }, { status: 500 });
  }
}
