import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";

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
    await recordHeartbeat("ticket-sla", "ok", JSON.stringify(summary));
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Ticket SLA escalation failed.";
    console.error("ticket-sla cron", detail);
    await recordHeartbeat("ticket-sla", "error", detail);
    return NextResponse.json({ ok: false, error: "ticket_sla_failed" }, { status: 500 });
  }
}
