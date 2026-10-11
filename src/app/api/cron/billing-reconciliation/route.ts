import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { heartbeatFor } from "@/lib/cron-heartbeat-status";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const summary = await runBillingReconciliation(50);
    // İade gerektiren yakalama (refund_required) operasyon kuyruğudur: yeşil görünmemeli. manualReview yalnız nota girer.
    const refundRequired = summary.refundRequired > 0;
    const note = `${JSON.stringify(summary)}${refundRequired ? ` · ${summary.refundRequired} iade gerekli` : ""}${summary.manualReview > 0 ? ` · ${summary.manualReview} elle inceleme` : ""}`;
    await recordHeartbeat("billing-reconciliation", refundRequired ? "error" : heartbeatFor({}), note);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("billing-reconciliation", "error", detail);
    return NextResponse.json(
      { ok: false, error: "billing_reconciliation_failed" },
      { status: 500 },
    );
  }
}
