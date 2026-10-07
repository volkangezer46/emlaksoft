"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import {
  DIRECT_FILE_UPLOAD_CONFIG,
  buildDirectFileUploadPath,
  isUuid,
  validateDirectFileUploadMetadata,
  type DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import { verifyDocumentFile } from "@/lib/file-validation";
import { isDocType } from "@/lib/doc-request/doc-request";
import {
  DOC_REQUEST_BUCKET,
  hashRequestToken,
  lookupPublicRequest,
} from "@/lib/doc-request/server";
import { actionErrorMessage } from "@/lib/action-errors";

export type PublicUploadFinalizeResult = { ok?: boolean; error?: string; fileCount?: number };
export type PublicCompleteResult = { ok?: boolean; error?: string };

const CLOSED_MESSAGES: Record<string, string> = {
  expired: "Bu bağlantının süresi doldu. Lütfen ofisinizden yeni bir bağlantı isteyin.",
  revoked: "Bu bağlantı ofis tarafından iptal edildi.",
  completed: "Bu bağlantı ile evraklar zaten gönderildi.",
  full: "Bu bağlantı için dosya sınırına ulaşıldı.",
};
const BUSY = "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
const PENDING_WINDOW_MS = 30 * 60 * 1000;

async function limited(tokenHash: string, kind: string, ipLimit: number, tokenLimit: number): Promise<boolean> {
  const ip = await clientIp();
  const [byIp, byToken] = await Promise.all([
    checkRateLimit(`doc-request:${kind}:ip:${ip}`, { limit: ipLimit, windowSec: 10 * 60, failurePolicy: "deny" }),
    checkRateLimit(`doc-request:${kind}:token:${tokenHash}`, {
      limit: tokenLimit,
      windowSec: 10 * 60,
      failurePolicy: "deny",
    }),
  ]);
  return !byIp.allowed || !byToken.allowed;
}

/**
 * Müşterinin yükleme için tek-nesnelik özel depolama yazma izni almasını sağlar.
 * Token geçerli, süreli ve dosya sınırı dolmamış olmalı; tür/boyut/MIME mevcut müşteri dosyası
 * doğrulamasıyla (validateDirectFileUploadMetadata, kind=customer_file) yapılır. Oturum yoktur;
 * tenant_id kullanıcıdan alınmaz, token'ın çözdüğü kayda sabittir.
 */
export async function prepareDocRequestUpload(
  token: string,
  input: { fileName: string; fileSize: number; fileType: string; docType: string },
): Promise<DirectFileUploadPrepareResult> {
  const lookup = await lookupPublicRequest(token);
  if (!lookup.ok) return { error: "Bağlantı geçersiz veya kapalı." };
  const tokenHash = hashRequestToken(token);
  if (await limited(tokenHash, "prepare", 60, 40)) return { error: BUSY };
  if (lookup.state !== "ok") return { error: CLOSED_MESSAGES[lookup.state] ?? "Bağlantı kapalı." };
  const { request } = lookup;

  const docType = String(input?.docType ?? "");
  if (!isDocType(docType) || !request.requested_types.includes(docType)) {
    return { error: "Bu evrak türü bu bağlantıda istenmedi." };
  }
  const meta = validateDirectFileUploadMetadata("customer_file", {
    parentId: request.id,
    fileName: input?.fileName,
    fileSize: input?.fileSize,
    fileType: input?.fileType,
    label: null,
  });
  if (!meta.ok) return { error: meta.error };

  const admin = createAdminClient();
  // Doğrulanmış + yakın zamanda açılmış bekleyen dosyalar sınıra sayılır (artık yetim satırlar saymaz).
  const sinceIso = new Date(now() - PENDING_WINDOW_MS).toISOString();
  const [{ count: verified }, { count: pending }] = await Promise.all([
    admin
      .from("document_request_files")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id)
      .eq("tenant_id", request.tenant_id)
      .eq("status", "verified"),
    admin
      .from("document_request_files")
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id)
      .eq("tenant_id", request.tenant_id)
      .eq("status", "pending")
      .gte("created_at", sinceIso),
  ]);
  if ((verified ?? 0) + (pending ?? 0) >= request.max_files) return { error: CLOSED_MESSAGES.full };

  const fileId = crypto.randomUUID();
  const path = buildDirectFileUploadPath(request.tenant_id, request.id, fileId, meta.value.canonicalExtension);
  const { error: insertError } = await admin.from("document_request_files").insert({
    id: fileId,
    tenant_id: request.tenant_id,
    request_id: request.id,
    doc_type: docType,
    storage_path: path,
    file_name: meta.value.fileName,
    file_size: meta.value.fileSize,
    mime_type: meta.value.claimedMime,
    status: "pending",
    is_sample: false,
  });
  if (insertError) {
    console.error("prepareDocRequestUpload insert", { code: insertError.code });
    return { error: actionErrorMessage(insertError, "Yükleme oturumu oluşturulamadı.") };
  }
  const { data: signed, error: signError } = await admin.storage
    .from(DOC_REQUEST_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed?.token || signed.path !== path) {
    console.error("prepareDocRequestUpload sign", { code: signError?.name ?? null });
    await admin.from("document_request_files").update({ status: "blocked" }).eq("id", fileId).eq("status", "pending");
    return { error: actionErrorMessage(signError, "Güvenli yükleme bağlantısı oluşturulamadı.") };
  }
  return {
    ok: true,
    upload: {
      sessionId: fileId,
      bucket: DOC_REQUEST_BUCKET,
      path,
      token: signed.token,
      contentType: meta.value.claimedMime,
      finalizeBy: new Date(now() + 15 * 60 * 1000).toISOString(),
    },
  };
}

/** Yüklenen nesneyi bayt düzeyinde doğrular (imza, tür, boyut); geçemezse siler ve engeller. */
export async function finalizeDocRequestUpload(
  token: string,
  fileId: string,
): Promise<PublicUploadFinalizeResult> {
  const lookup = await lookupPublicRequest(token);
  if (!lookup.ok) return { error: "Bağlantı geçersiz veya kapalı." };
  if (!isUuid(fileId)) return { error: "Yükleme oturumu geçersiz." };
  const tokenHash = hashRequestToken(token);
  if (await limited(tokenHash, "finalize", 60, 40)) return { error: BUSY };
  // İptal/süre dolumu yükleme yolunu bu aşamada da kapatır; doluluk ise burada engel değildir.
  if (lookup.state === "revoked" || lookup.state === "expired" || lookup.state === "completed") {
    return { error: CLOSED_MESSAGES[lookup.state] };
  }
  const { request } = lookup;

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("document_request_files")
    .select("id, storage_path, file_name, file_size, mime_type, status")
    .eq("id", fileId)
    .eq("request_id", request.id)
    .eq("tenant_id", request.tenant_id)
    .maybeSingle();
  if (!row) return { error: "Yükleme oturumu bulunamadı." };
  if (row.status === "verified") return { ok: true, fileCount: request.file_count };
  if (row.status !== "pending") return { error: "Dosya güvenlik doğrulamasından geçemedi." };

  const block = async () => {
    await admin.from("document_request_files").update({ status: "blocked" }).eq("id", row.id);
    await admin.storage.from(DOC_REQUEST_BUCKET).remove([row.storage_path]);
  };

  const storage = admin.storage.from(DOC_REQUEST_BUCKET);
  const { data: blob, error: downloadError } = await storage.download(row.storage_path);
  if (downloadError || !blob) return { error: "Yüklenen dosya henüz bulunamadı. Lütfen tekrar deneyin." };
  const config = DIRECT_FILE_UPLOAD_CONFIG.customer_file;
  if (blob.size <= 0 || blob.size > config.maxBytes || blob.size !== Number(row.file_size)) {
    await block();
    return { error: "Yüklenen dosyanın boyutu beklenen değerle eşleşmiyor." };
  }
  const file = new File([blob], row.file_name, { type: row.mime_type });
  const verified = await verifyDocumentFile(file, config.allowedMime);
  if (!verified.ok || verified.type !== row.mime_type) {
    await block();
    return { error: verified.ok ? "Dosya içeriği ile bildirilen tür uyuşmuyor." : verified.error };
  }

  const verifiedAt = new Date(now()).toISOString();
  const { error: updateError } = await admin
    .from("document_request_files")
    .update({ status: "verified", verified_at: verifiedAt })
    .eq("id", row.id)
    .eq("status", "pending");
  if (updateError) return { error: "Dosya doğrulandı ancak kaydedilemedi. Lütfen yeniden deneyin." };

  const { count } = await admin
    .from("document_request_files")
    .select("id", { count: "exact", head: true })
    .eq("request_id", request.id)
    .eq("tenant_id", request.tenant_id)
    .eq("status", "verified");
  const fileCount = count ?? request.file_count + 1;
  await admin
    .from("document_requests")
    .update({ file_count: fileCount })
    .eq("id", request.id)
    .eq("tenant_id", request.tenant_id);

  await logActivity({
    tenantId: request.tenant_id,
    actorId: null,
    action: "document_request.upload",
    entityType: "document_request",
    entityId: request.id,
    newValue: { file_id: row.id, mime: row.mime_type, size: row.file_size },
  });
  return { ok: true, fileCount };
}

/** "Gönder": tek kullanımlık kapanış. En az bir doğrulanmış dosya gerekir; sonrasında yükleme kapanır. */
export async function completeDocRequest(token: string): Promise<PublicCompleteResult> {
  const lookup = await lookupPublicRequest(token);
  if (!lookup.ok) return { error: "Bağlantı geçersiz veya kapalı." };
  if (await limited(hashRequestToken(token), "complete", 20, 10)) return { error: BUSY };
  if (lookup.state === "revoked" || lookup.state === "expired" || lookup.state === "completed") {
    return { error: CLOSED_MESSAGES[lookup.state] };
  }
  const { request } = lookup;
  if (request.file_count < 1) return { error: "Göndermeden önce en az bir dosya yükleyin." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("document_requests")
    .update({ status: "completed", completed_at: new Date(now()).toISOString() })
    .eq("id", request.id)
    .eq("tenant_id", request.tenant_id)
    .eq("status", "active");
  if (error) return { error: actionErrorMessage(error, "Gönderim tamamlanamadı. Lütfen tekrar deneyin.") };
  await logActivity({
    tenantId: request.tenant_id,
    actorId: null,
    action: "document_request.completed",
    entityType: "document_request",
    entityId: request.id,
    newValue: { file_count: request.file_count },
  });
  return { ok: true };
}
