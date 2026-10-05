import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { authorizeCron } from "@/lib/cron-auth";
import { cleanupTicketAttachmentUploads } from "@/lib/ticket-attachments-cleanup";

/** Toplu/uzun işlem: varsayılan süre yetmeyebilir. */
export const maxDuration = 300;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request);
  if (denied) return denied;

  try {
    const summary = await cleanupTicketAttachmentUploads();
    await recordHeartbeat("ticket-attachment-cleanup", "ok", JSON.stringify(summary));
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ticket ek temizliği çalıştırılamadı.";
    await recordHeartbeat("ticket-attachment-cleanup", "error", message);
    return NextResponse.json({ ok: false, error: "ticket_attachment_cleanup_failed" }, { status: 500 });
  }
}
