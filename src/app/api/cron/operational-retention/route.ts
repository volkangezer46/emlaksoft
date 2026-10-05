import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { processStorageDeletionOutbox } from "@/lib/storage-deletion-outbox";
import { authorizeCron } from "@/lib/cron-auth";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = authorizeCron(req);
  if (denied) return denied;

  try {
    const admin = createAdminClient();
    const { data: retention, error } = await admin.rpc("run_operational_retention");
    if (error) throw new Error(`retention rpc failed: ${error.code}`);

    const storage = await processStorageDeletionOutbox(50);
    const detail = JSON.stringify({ retention, storage });
    await recordHeartbeat("operational-retention", "ok", detail);
    return NextResponse.json({ ok: true, retention, storage });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordHeartbeat("operational-retention", "error", detail);
    return NextResponse.json(
      { ok: false, error: "operational_retention_failed" },
      { status: 500 },
    );
  }
}

