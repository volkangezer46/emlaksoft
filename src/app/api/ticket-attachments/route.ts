import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { authorizeTicketAttachmentAccess } from "@/lib/ticket-attachments-access";
import {
  buildTicketAttachmentPath,
  isUuid,
  prepareTicketAttachmentUploadDescriptor,
  TICKET_ATTACHMENT_BUCKET,
  TICKET_ATTACHMENT_MAX_FILES,
  type TicketAttachmentVisibility,
} from "@/lib/ticket-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadRequest = {
  ticketId?: unknown;
  messageId?: unknown;
  visibility?: unknown;
  files?: unknown;
};

type RequestedFile = { name?: unknown; type?: unknown; size?: unknown };

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Kısa ömürlü, yalnız upload yetkili oturumlar oluşturur. Dosya gövdesi
 * Vercel Function'a gelmez; tarayıcı Supabase'in private bucket'ına doğrudan
 * yazar. Bu token okuma/indirme yetkisi vermez ve metadata ancak finalize
 * endpoint'i gerçek baytları doğruladıktan sonra oluşur.
 */
export async function POST(request: NextRequest) {
  let payload: UploadRequest;
  try {
    payload = (await request.json()) as UploadRequest;
  } catch {
    return jsonError("Dosya oturumu isteği okunamadı.", 400);
  }

  const ticketId = typeof payload.ticketId === "string" ? payload.ticketId.trim() : "";
  const messageId = typeof payload.messageId === "string" ? payload.messageId.trim() : "";
  const requestedVisibility = typeof payload.visibility === "string" ? payload.visibility.trim() : "public";
  if (!isUuid(ticketId)) return jsonError("Destek talebi bulunamadı.", 404);
  if (messageId && !isUuid(messageId)) return jsonError("Mesaj bilgisi geçersiz.", 400);
  if (!(["public", "internal"] as const).includes(requestedVisibility as TicketAttachmentVisibility)) {
    return jsonError("Dosya görünürlüğü geçersiz.", 400);
  }

  const access = await authorizeTicketAttachmentAccess(ticketId, "write");
  if (!access.ok) return jsonError(access.error, access.status);
  const visibility = requestedVisibility as TicketAttachmentVisibility;
  if (access.actor.kind === "tenant" && visibility !== "public") {
    return jsonError("İç not ekleri yalnız destek personeli tarafından yüklenebilir.", 403);
  }
  const closedWithoutInternalStaffException =
    access.ticket.status === "closed" && !(access.actor.kind === "staff" && visibility === "internal");
  if (closedWithoutInternalStaffException || (access.actor.kind === "tenant" && access.ticket.status === "resolved")) {
    return jsonError("Kapatılmış talebe dosya eklenemez.", 409);
  }

  const limit = await checkRateLimit(`ticket-attachment-session:${access.actor.userId}`, {
    limit: 20,
    windowSec: 10 * 60,
    failurePolicy: "deny",
  });
  if (!limit.allowed) return jsonError("Çok fazla dosya yükleme denemesi yapıldı. Lütfen daha sonra tekrar deneyin.", 429);

  const requestedFiles = Array.isArray(payload.files) ? (payload.files as RequestedFile[]) : [];
  if (requestedFiles.length === 0) return jsonError("En az bir dosya seçin.", 400);
  if (requestedFiles.length > TICKET_ATTACHMENT_MAX_FILES) {
    return jsonError(`Bir defada en fazla ${TICKET_ATTACHMENT_MAX_FILES} dosya yükleyebilirsiniz.`, 400);
  }

  const prepared = requestedFiles.map((file) =>
    prepareTicketAttachmentUploadDescriptor({
      name: typeof file.name === "string" ? file.name : "",
      type: typeof file.type === "string" ? file.type : "",
      size: typeof file.size === "number" ? file.size : Number.NaN,
    }),
  );
  const invalid = prepared.find((item) => !item.ok);
  if (invalid && !invalid.ok) return jsonError(invalid.error, 415);

  const admin = createAdminClient();
  if (messageId) {
    const { data: message, error } = await admin
      .from("support_ticket_messages")
      .select("id, ticket_id, visibility, author_user_id, author_kind")
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw new Error(`Ticket mesaj eki doğrulanamadı: ${error.message}`);
    if (
      !message ||
      message.ticket_id !== ticketId ||
      message.visibility !== visibility ||
      message.author_user_id !== access.actor.userId ||
      message.author_kind !== access.actor.kind
    ) {
      return jsonError("Dosyanın bağlanacağı mesaj bulunamadı.", 409);
    }
  }

  const sessions: Array<{
    id: string;
    path: string;
    token: string;
    fileName: string;
    mimeType: string;
    size: number;
  }> = [];
  const sessionIds: string[] = [];

  for (const result of prepared) {
    if (!result.ok) continue;
    const id = crypto.randomUUID();
    const storagePath = buildTicketAttachmentPath(
      access.ticket.tenant_id,
      access.ticket.id,
      id,
      result.value.extension,
    );
    const { error: insertError } = await admin.from("support_ticket_attachment_uploads").insert({
      id,
      tenant_id: access.ticket.tenant_id,
      ticket_id: access.ticket.id,
      message_id: messageId || null,
      requested_by: access.actor.userId,
      requested_by_kind: access.actor.kind,
      visibility,
      file_name: result.value.fileName,
      claimed_mime: result.value.claimedMime,
      file_size: result.value.size,
      storage_path: storagePath,
      status: "pending",
    });
    if (insertError) {
      if (sessionIds.length) await admin.from("support_ticket_attachment_uploads").delete().in("id", sessionIds);
      console.error("ticket attachment session insert failed", { code: insertError.code });
      return jsonError("Dosya yükleme oturumu oluşturulamadı.", 503);
    }
    sessionIds.push(id);

    const { data: signed, error: signedError } = await admin.storage
      .from(TICKET_ATTACHMENT_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (signedError || !signed?.token) {
      await admin.from("support_ticket_attachment_uploads").delete().in("id", sessionIds);
      console.error("ticket attachment signed upload failed", { statusCode: signedError?.statusCode });
      return jsonError("Güvenli yükleme başlatılamadı.", 503);
    }
    sessions.push({
      id,
      path: storagePath,
      token: signed.token,
      fileName: result.value.fileName,
      mimeType: result.value.claimedMime,
      size: result.value.size,
    });
  }

  return NextResponse.json({ ok: true, bucket: TICKET_ATTACHMENT_BUCKET, sessions }, { status: 201 });
}
