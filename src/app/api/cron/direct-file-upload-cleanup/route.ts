import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { cleanupDirectFileUploads } from "@/lib/direct-file-upload-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
