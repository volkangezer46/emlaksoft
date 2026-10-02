import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStoredTicketAttachment } from "@/lib/ticket-attachments-access";
import {
  isSafeTicketAttachmentPath,
  TICKET_ATTACHMENT_BUCKET,
} from "@/lib/ticket-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFoundResponse() {
  return Response.json({ error: "Dosya bulunamadı." }, { status: 404 });
}

function asciiFileName(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\/]/g, "-")
    .trim();
  return (normalized || "destek-dosyasi").slice(0, 120);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await authorizeStoredTicketAttachment(id, "download");
  // Yetkisiz nesne kimliklerini doğrulamamak için 403 yerine aynı 404 cevabı.
  if (!access.ok) return notFoundResponse();

  const { attachment, ticket } = access;
  if (
    attachment.scan_status !== "signature_verified" ||
    !isSafeTicketAttachmentPath(attachment.storage_path, ticket.tenant_id, ticket.id)
  ) {
    return notFoundResponse();
  }

  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage
    .from(TICKET_ATTACHMENT_BUCKET)
    .download(attachment.storage_path);
  if (error || !blob) {
    console.error("ticket attachment download failed", { statusCode: error?.statusCode });
    return notFoundResponse();
  }

  const fallback = asciiFileName(attachment.file_name);
  const encoded = encodeURIComponent(attachment.file_name)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
  return new Response(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": attachment.mime_type,
      "Content-Length": String(attachment.file_size),
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
