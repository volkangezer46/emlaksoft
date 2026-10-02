import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { authorizeTicketAttachmentAccess } from "@/lib/ticket-attachments-access";
import {
  isSafeTicketAttachmentPath,
  isUuid,
  TICKET_ATTACHMENT_BUCKET,
  TICKET_ATTACHMENT_MAX_FILES,
  verifyTicketAttachment,
  type TicketAttachmentVisibility,
} from "@/lib/ticket-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadSessionRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  message_id: string | null;
  requested_by: string | null;
  requested_by_kind: "tenant" | "staff";
  visibility: TicketAttachmentVisibility;
  file_name: string;
  claimed_mime: string;
  file_size: number;
  storage_path: string;
  status: "pending" | "finalizing" | "finalized" | "blocked" | "expired";
  expires_at: string;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Private bucket'taki geçici nesneyi sunucuda indirir; magic-byte, MIME,
 * boyut ve SHA-256 kontrolünden geçenleri kalıcı metadata haline getirir. */
export async function POST(request: NextRequest) {
  let body: { sessionIds?: unknown };
  try {
    body = (await request.json()) as { sessionIds?: unknown };
  } catch {
    return jsonError("Dosya doğrulama isteği okunamadı.", 400);
  }

  const ids = Array.isArray(body.sessionIds)
    ? Array.from(new Set(body.sessionIds.filter((value): value is string => typeof value === "string" && isUuid(value))))
    : [];
  if (ids.length === 0) return jsonError("Doğrulanacak dosya bulunamadı.", 400);
  if (ids.length > TICKET_ATTACHMENT_MAX_FILES) return jsonError("Dosya sayısı sınırı aşıldı.", 400);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_ticket_attachment_uploads")
    .select(
      "id, tenant_id, ticket_id, message_id, requested_by, requested_by_kind, visibility, file_name, claimed_mime, file_size, storage_path, status, expires_at",
    )
    .in("id", ids);
  if (error) throw new Error(`Ticket ek oturumları sorgulanamadı: ${error.message}`);
  const sessions = (data ?? []) as UploadSessionRow[];
  if (sessions.length !== ids.length) return jsonError("Dosya yükleme oturumu bulunamadı.", 404);

  // İlk ticket yetkisi actor kimliğini de güvenilir oturumdan türetir.
  const firstAccess = await authorizeTicketAttachmentAccess(sessions[0]!.ticket_id, "write");
  if (!firstAccess.ok) return jsonError(firstAccess.error, firstAccess.status);
  const rate = await checkRateLimit(`ticket-attachment-finalize:${firstAccess.actor.userId}`, {
    limit: 30,
    windowSec: 10 * 60,
    failurePolicy: "deny",
  });
  if (!rate.allowed) return jsonError("Çok fazla dosya doğrulama denemesi yapıldı.", 429);

  const results: Array<{
    sessionId: string;
    ok: boolean;
    attachment?: {
      id: string;
      message_id: string | null;
      visibility: TicketAttachmentVisibility;
      file_name: string;
      mime_type: string;
      file_size: number;
      scan_status: "signature_verified";
      created_at: string;
    };
    error?: string;
  }> = [];
  const touchedTickets = new Set<string>();

  for (const session of sessions) {
    const access = session.ticket_id === firstAccess.ticket.id
      ? firstAccess
      : await authorizeTicketAttachmentAccess(session.ticket_id, "write");
    if (
      !access.ok ||
      !session.requested_by ||
      access.actor.userId !== session.requested_by ||
      access.actor.kind !== session.requested_by_kind ||
      access.ticket.tenant_id !== session.tenant_id
    ) {
      results.push({ sessionId: session.id, ok: false, error: "Dosya yükleme oturumu bulunamadı." });
      continue;
    }
    if (session.status === "finalized") {
      const { data: existing } = await admin
        .from("support_ticket_attachments")
        .select("id, message_id, visibility, file_name, mime_type, file_size, scan_status, created_at")
        .eq("id", session.id)
        .maybeSingle();
      if (existing?.scan_status === "signature_verified") {
        results.push({ sessionId: session.id, ok: true, attachment: existing as NonNullable<(typeof results)[number]["attachment"]> });
      } else {
        results.push({ sessionId: session.id, ok: false, error: "Dosya kaydı doğrulanamadı." });
      }
      continue;
    }
    if (session.status !== "pending") {
      results.push({
        sessionId: session.id,
        ok: false,
        error: session.status === "finalizing" ? "Dosya güvenlik denetimi sürüyor." : "Dosya güvenlik denetiminden geçmedi.",
      });
      continue;
    }
    const closedWithoutInternalStaffException =
      access.ticket.status === "closed" && !(access.actor.kind === "staff" && session.visibility === "internal");
    if (closedWithoutInternalStaffException || (access.actor.kind === "tenant" && access.ticket.status === "resolved")) {
      const { data: blocked, error: blockError } = await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "blocked", blocked_reason: "ticket_no_longer_writable" })
        .eq("id", session.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (blockError) throw new Error(`Ticket ek oturumu bloke edilemedi: ${blockError.message}`);
      if (blocked) await admin.storage.from(TICKET_ATTACHMENT_BUCKET).remove([session.storage_path]);
      results.push({ sessionId: session.id, ok: false, error: "Kapatılmış talebe dosya eklenemez." });
      continue;
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      const { data: expired, error: expireError } = await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "expired", blocked_reason: "upload_session_expired" })
        .eq("id", session.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (expireError) throw new Error(`Ticket ek oturumu sonlandırılamadı: ${expireError.message}`);
      if (expired) await admin.storage.from(TICKET_ATTACHMENT_BUCKET).remove([session.storage_path]);
      results.push({ sessionId: session.id, ok: false, error: "Dosya yükleme süresi doldu." });
      continue;
    }
    if (!isSafeTicketAttachmentPath(session.storage_path, session.tenant_id, session.ticket_id)) {
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "blocked", blocked_reason: "unsafe_storage_path" })
        .eq("id", session.id)
        .eq("status", "pending");
      results.push({ sessionId: session.id, ok: false, error: "Dosya yolu doğrulanamadı." });
      continue;
    }

    // Cleanup ile yarışmayı kesen kısa lease. Yalnız pending'i finalizing'e
    // alan istek nesnenin sahibi olur; çöken worker lease sonunda cleanup'a düşer.
    const leaseUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("support_ticket_attachment_uploads")
      .update({ status: "finalizing", expires_at: leaseUntil })
      .eq("id", session.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(`Ticket ek doğrulama lease'i alınamadı: ${claimError.message}`);
    if (!claimed) {
      results.push({ sessionId: session.id, ok: false, error: "Dosya başka bir işlem tarafından doğrulanıyor." });
      continue;
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(TICKET_ATTACHMENT_BUCKET)
      .download(session.storage_path);
    if (downloadError || !blob) {
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "pending", expires_at: session.expires_at })
        .eq("id", session.id)
        .eq("status", "finalizing");
      results.push({ sessionId: session.id, ok: false, error: "Dosya henüz güvenli depoya ulaşmadı." });
      continue;
    }

    const content = new Uint8Array(await blob.arrayBuffer());
    const uploadedFile = new File([content], session.file_name, { type: session.claimed_mime });
    const verified = session.file_size === content.byteLength
      ? await verifyTicketAttachment(uploadedFile)
      : { ok: false as const, error: "Dosya boyutu yükleme oturumuyla uyuşmuyor." };
    const expectedExtension = session.storage_path.split(".").pop()?.toLowerCase();
    if (!verified.ok || verified.value.extension !== expectedExtension) {
      const { data: blocked, error: blockError } = await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "blocked", blocked_reason: "content_verification_failed" })
        .eq("id", session.id)
        .eq("status", "finalizing")
        .select("id")
        .maybeSingle();
      if (blockError) throw new Error(`Ticket ek güvenlik kararı kaydedilemedi: ${blockError.message}`);
      if (blocked) await admin.storage.from(TICKET_ATTACHMENT_BUCKET).remove([session.storage_path]);
      results.push({
        sessionId: session.id,
        ok: false,
        error: verified.ok ? "Dosya türü doğrulanamadı." : verified.error,
      });
      continue;
    }

    // Metadata insertinden hemen önce lease'i atomik uzat. Cleanup daha önce
    // expired sahipliğini aldıysa insert yapılmaz; finalize uzattıysa cleanup'ın
    // eski snapshot'ı CAS koşulunu geçemez.
    const { data: leaseOwned, error: leaseError } = await admin
      .from("support_ticket_attachment_uploads")
      .update({ expires_at: new Date(Date.now() + 10 * 60_000).toISOString() })
      .eq("id", session.id)
      .eq("status", "finalizing")
      .gt("expires_at", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (leaseError) throw new Error(`Ticket ek doğrulama lease'i yenilenemedi: ${leaseError.message}`);
    if (!leaseOwned) {
      results.push({ sessionId: session.id, ok: false, error: "Dosya doğrulama oturumunun süresi doldu." });
      continue;
    }

    const row = {
      id: session.id,
      tenant_id: session.tenant_id,
      ticket_id: session.ticket_id,
      message_id: session.message_id,
      uploaded_by: session.requested_by,
      uploaded_by_kind: session.requested_by_kind,
      visibility: session.visibility,
      file_name: verified.value.fileName,
      storage_path: session.storage_path,
      mime_type: verified.value.mimeType,
      file_size: verified.value.size,
      sha256: verified.value.sha256,
      scan_status: "signature_verified" as const,
    };
    const { data: inserted, error: insertError } = await admin
      .from("support_ticket_attachments")
      .insert(row)
      .select("id, message_id, visibility, file_name, mime_type, file_size, scan_status, created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: existing } = await admin
          .from("support_ticket_attachments")
          .select("id, message_id, visibility, file_name, mime_type, file_size, scan_status, created_at")
          .eq("id", session.id)
          .maybeSingle();
        if (existing?.scan_status === "signature_verified") {
          await admin
            .from("support_ticket_attachment_uploads")
            .update({ status: "finalized", finalized_at: new Date().toISOString(), blocked_reason: null })
            .eq("id", session.id)
            .eq("status", "finalizing");
          touchedTickets.add(session.ticket_id);
          results.push({ sessionId: session.id, ok: true, attachment: existing as NonNullable<(typeof results)[number]["attachment"]> });
          continue;
        }
      }
      console.error("ticket attachment finalize insert failed", { code: insertError.code });
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "pending", expires_at: session.expires_at })
        .eq("id", session.id)
        .eq("status", "finalizing");
      results.push({ sessionId: session.id, ok: false, error: "Dosya kaydı tamamlanamadı." });
      continue;
    }

    const { data: finalized, error: finalizeError } = await admin
      .from("support_ticket_attachment_uploads")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), blocked_reason: null })
      .eq("id", session.id)
      .eq("status", "finalizing")
      .select("id")
      .maybeSingle();
    if (finalizeError || !finalized) {
      console.error("ticket attachment session finalize marker failed", { code: finalizeError?.code ?? "cas_miss" });
    }

    touchedTickets.add(session.ticket_id);
    results.push({ sessionId: session.id, ok: true, attachment: inserted as NonNullable<(typeof results)[number]["attachment"]> });
  }

  for (const ticketId of touchedTickets) {
    revalidatePath(`/admin/tickets/${ticketId}`);
    revalidatePath(`/app/destek/${ticketId}`);
  }

  const failed = results.filter((result) => !result.ok).length;
  return NextResponse.json(
    { ok: failed === 0, partial: failed > 0 && failed < results.length, results },
    { status: failed === 0 ? 201 : failed === results.length ? 422 : 207 },
  );
}
