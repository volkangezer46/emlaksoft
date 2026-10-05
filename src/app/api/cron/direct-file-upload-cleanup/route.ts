import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { cleanupDirectFileUploads } from "@/lib/direct-file-upload-cleanup";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await cleanupDirectFileUploads();
    await recordHeartbeat("direct-file-upload-cleanup", "ok", JSON.stringify(summary));
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Doğrudan yükleme temizliği çalıştırılamadı.";
    await recordHeartbeat("direct-file-upload-cleanup", "error", detail);
    return NextResponse.json({ ok: false, error: "direct_file_upload_cleanup_failed" }, { status: 500 });
  }
}
