import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  isSafeTicketAttachmentPath,
  TICKET_ATTACHMENT_BUCKET,
} from "@/lib/ticket-attachments";

export type TicketAttachmentCleanupSummary = {
  scanned: number;
  objectsRemoved: number;
  sessionsExpired: number;
  envelopesDeleted: number;
  failed: number;
};

/**
 * Signed upload tamamlanıp finalize edilmese bile private bucket'ta orphan
 * bırakmaz. Küçük batch + kararlı sıra her cron çalışmasını sınırlı
 * tutar; başarısız nesne bir sonraki turda yeniden denenir.
 */
export async function cleanupTicketAttachmentUploads(
  now = new Date(),
  limit = 100,
): Promise<TicketAttachmentCleanupSummary> {
  const admin = createAdminClient();
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 100, 250));
  const summary: TicketAttachmentCleanupSummary = {
    scanned: 0,
    objectsRemoved: 0,
    sessionsExpired: 0,
    envelopesDeleted: 0,
    failed: 0,
  };

  const { data: expired, error: queryError } = await admin
    .from("support_ticket_attachment_uploads")
    .select("id, tenant_id, ticket_id, storage_path, status")
    .in("status", ["pending", "finalizing"])
    .lte("expires_at", now.toISOString())
    .order("expires_at", { ascending: true })
    .limit(boundedLimit);
  if (queryError) throw new Error(`Ticket ek cleanup sorgusu başarısız: ${queryError.message}`);

  for (const session of expired ?? []) {
    summary.scanned += 1;
    // Önce süresi dolan lease'i CAS ile sahiplen; finalize aynı anda
    // pending->finalizing veya lease uzatmışsa bu tur nesneye dokunmaz.
    const { data: claimed, error: claimError } = await admin
      .from("support_ticket_attachment_uploads")
      .update({ status: "expired", blocked_reason: "upload_session_expired" })
      .eq("id", session.id)
      .eq("status", session.status)
      .lte("expires_at", now.toISOString())
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(`Ticket ek cleanup lease'i alınamadı: ${claimError.message}`);
    if (!claimed) continue;

    // Metadata mevcutsa finalize tamamlanmış, yalnız işaretleme cevabı kaybolmuş
    // demektir. Private nesne asla silinmez; zarf onarılır.
    const { data: attachment, error: attachmentError } = await admin
      .from("support_ticket_attachments")
      .select("id")
      .eq("id", session.id)
      .maybeSingle();
    if (attachmentError) {
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: session.status, blocked_reason: null })
        .eq("id", session.id)
        .eq("status", "expired");
      throw new Error(`Ticket ek metadata cleanup kontrolü başarısız: ${attachmentError.message}`);
    }
    if (attachment) {
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: "finalized", finalized_at: now.toISOString(), blocked_reason: null })
        .eq("id", session.id)
        .eq("status", "expired");
      continue;
    }

    if (!isSafeTicketAttachmentPath(session.storage_path, session.tenant_id, session.ticket_id)) {
      summary.failed += 1;
      continue;
    }
    const { error: removeError } = await admin.storage
      .from(TICKET_ATTACHMENT_BUCKET)
      .remove([session.storage_path]);
    if (removeError) {
      await admin
        .from("support_ticket_attachment_uploads")
        .update({ status: session.status, blocked_reason: null })
        .eq("id", session.id)
        .eq("status", "expired");
      summary.failed += 1;
      continue;
    }
    summary.objectsRemoved += 1;
    summary.sessionsExpired += 1;
  }

  // Finalize/blocked/expired zarfları idempotency yarışları için yedi gün
  // tutulur; asıl dosya metadata'sı support_ticket_attachments'ta kalır.
  const envelopeCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: deleted, error: deleteError } = await admin
    .from("support_ticket_attachment_uploads")
    .delete()
    .in("status", ["finalized", "blocked", "expired"])
    .lt("created_at", envelopeCutoff)
    .select("id");
  if (deleteError) throw new Error(`Ticket ek oturum zarfları temizlenemedi: ${deleteError.message}`);
  summary.envelopesDeleted = deleted?.length ?? 0;

  return summary;
}
