import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/cron-heartbeat";
import { cleanupTicketAttachmentUploads } from "@/lib/ticket-attachments-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
