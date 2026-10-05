import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { processPublicMutationOutbox } from "@/lib/public-mutation-outbox";
import { authorizeCron } from "@/lib/cron-auth";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const summary = await processPublicMutationOutbox(50);
    await recordHeartbeat("public-mutation-outbox", "ok", JSON.stringify(summary));
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    await recordHeartbeat("public-mutation-outbox", "error", detail);
    return NextResponse.json(
      { ok: false, error: "public_mutation_outbox_failed" },
      { status: 500 },
    );
  }
}
