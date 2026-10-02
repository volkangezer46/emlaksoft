"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { authorizeStoredTicketAttachment } from "@/lib/ticket-attachments-access";
import {
  isSafeTicketAttachmentPath,
  isUuid,
  TICKET_ATTACHMENT_BUCKET,
} from "@/lib/ticket-attachments";

export type TicketAttachmentActionResult = {
  ok?: boolean;
  error?: string;
  attachmentId?: string;
};

/**
 * Soft-delete metadata + private bucket temizliği. Tenant yöneticisi dahil
 * tenant aktörleri yalnız kendi yüklediği public eki silebilir; ticket modülü
 * yetkili platform personeli her eki yönetebilir.
 */
export async function deleteTicketAttachment(
  _previous: TicketAttachmentActionResult,
  formData: FormData,
): Promise<TicketAttachmentActionResult> {
  // İçe aktarılan nesne-yetki yardımcısına ek olarak action kapısını açıkça
  // kurar. getRequestUser istek başına cache'lidir; ikinci doğrulama ağ çağrısı yapmaz.
  if (!(await getRequestUser())) return { error: "Oturum bulunamadı." };
  const attachmentId = String(formData.get("attachment_id") ?? "").trim();
  if (!isUuid(attachmentId)) return { error: "Dosya bulunamadı." };

  const access = await authorizeStoredTicketAttachment(attachmentId, "delete");
  if (!access.ok) return { error: access.error };
  const { attachment, actor, ticket } = access;
  if (!isSafeTicketAttachmentPath(attachment.storage_path, ticket.tenant_id, ticket.id)) {
    return { error: "Dosya yolu doğrulanamadı." };
  }

  const admin = createAdminClient();
  // Metadata güncellemesi başarısız olursa private nesneyi aynı yola geri
  // koyabilmek için silmeden önce kısa süreli sunucu kopyası alınır.
  const { data: blob, error: downloadError } = await admin.storage
    .from(TICKET_ATTACHMENT_BUCKET)
    .download(attachment.storage_path);
  if (downloadError || !blob) return { error: "Dosya güvenli depoda bulunamadı." };

  const { error: storageError } = await admin.storage
    .from(TICKET_ATTACHMENT_BUCKET)
    .remove([attachment.storage_path]);
  if (storageError) {
    console.error("ticket attachment storage delete failed", { statusCode: storageError.statusCode });
    return { error: "Dosya silinemedi." };
  }

  const deletedAt = new Date().toISOString();
  const { data: updated, error: metadataError } = await admin
    .from("support_ticket_attachments")
    .update({
      deleted_at: deletedAt,
      deleted_by: actor.userId,
      deleted_by_kind: actor.kind,
    })
    .eq("id", attachment.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (metadataError || !updated) {
    // Çift silme yarışında ikinci CAS 0 satır döner. Başka istek metadata'yı
    // zaten soft-delete ettiyse nesneyi geri yüklemek private orphan üretir.
    const { data: current, error: stateError } = await admin
      .from("support_ticket_attachments")
      .select("id, deleted_at")
      .eq("id", attachment.id)
      .maybeSingle();
    if (!stateError && (!current || current.deleted_at)) {
      revalidatePath(`/admin/tickets/${ticket.id}`);
      revalidatePath(`/app/destek/${ticket.id}`);
      return { ok: true, attachmentId: attachment.id };
    }
    if (stateError) {
      console.error("ticket attachment delete state reconciliation failed", { code: stateError.code });
      return { error: "Dosya kaydı doğrulanamadı; işlem güvenli biçimde durduruldu." };
    }

    const { error: restoreError } = await admin.storage
      .from(TICKET_ATTACHMENT_BUCKET)
      .upload(attachment.storage_path, blob, {
        contentType: attachment.mime_type,
        cacheControl: "0",
        upsert: false,
      });
    if (restoreError) {
      console.error("ticket attachment delete rollback failed", { statusCode: restoreError.statusCode });
    }
    return { error: "Dosya kaydı silinemedi." };
  }

  revalidatePath(`/admin/tickets/${ticket.id}`);
  revalidatePath(`/app/destek/${ticket.id}`);
  return { ok: true, attachmentId: attachment.id };
}
