import { NextRequest, NextResponse } from "next/server";
import { runBillingReconciliation } from "@/lib/billing/reconciliation";
import { recordHeartbeat } from "@/lib/cron-heartbeat";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runBillingReconciliation(50);
    await recordHeartbeat("billing-reconciliation", "ok", JSON.stringify(summary));
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
