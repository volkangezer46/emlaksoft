import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  DIRECT_FILE_UPLOAD_CLEANUP_BUFFER_MS,
  DIRECT_FILE_UPLOAD_CONFIG,
  DIRECT_FILE_UPLOAD_FINALIZE_TTL_MS,
  DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS,
  buildDirectFileUploadPath,
  isSafeDirectFileUploadPath,
  isUuid,
  validateDirectFileUploadMetadata,
  type DirectFileUploadBucket,
  type DirectFileUploadFinalizeResult,
  type DirectFileUploadKind,
  type DirectFileUploadMetadata,
  type DirectFileUploadPrepareResult,
} from "@/lib/direct-file-uploads";
import { verifyDocumentFile, verifyImageFile } from "@/lib/file-validation";

export type AuthorizedDirectFileUpload = {
  kind: DirectFileUploadKind;
  tenantId: string;
  parentId: string;
  userId: string;
};

type DirectFileUploadSession = {
  id: string;
  tenant_id: string;
  kind: DirectFileUploadKind;
  customer_id: string | null;
  property_id: string | null;
  /** 20261007000700 öncesi şemada sütun yoktur (yalnız gider fişi oturumunda dolu). */
  expense_id?: string | null;
  requested_by: string;
  bucket: DirectFileUploadBucket;
  storage_path: string;
  file_name: string;
  file_size: number;
  claimed_mime: string;
  canonical_extension: string;
  status: "pending" | "finalizing" | "finalized" | "blocked" | "expired" | "cleanup_queued";
  lease_id: string | null;
  finalize_expires_at: string;
};

function contextIsValid(context: AuthorizedDirectFileUpload) {
  return isUuid(context.tenantId) && isUuid(context.parentId) && isUuid(context.userId);
}

/** Oturumun üst kaydı (tür → sütun; tek eşleme). */
export function sessionParentId(
  kind: DirectFileUploadKind,
  session: { customer_id: string | null; property_id: string | null; expense_id?: string | null },
): string | null {
  if (kind === "customer_file") return session.customer_id;
  if (kind === "expense_receipt") return session.expense_id ?? null;
  return session.property_id;
}

function sessionMatchesContext(session: DirectFileUploadSession, context: AuthorizedDirectFileUpload) {
  const parentId = sessionParentId(context.kind, session);
  return (
    session.id &&
    session.kind === context.kind &&
    session.tenant_id === context.tenantId &&
    session.requested_by === context.userId &&
    parentId === context.parentId &&
    session.bucket === DIRECT_FILE_UPLOAD_CONFIG[context.kind].bucket &&
    isSafeDirectFileUploadPath({
      path: session.storage_path,
      tenantId: context.tenantId,
      parentId: context.parentId,
      sessionId: session.id,
      extension: session.canonical_extension,
    })
  );
}

function safeStorageError(error: { code?: string; statusCode?: string | number } | null) {
  return error ? { code: error.code ?? null, statusCode: error.statusCode ?? null } : null;
}

export async function prepareDirectFileUpload(
  context: AuthorizedDirectFileUpload,
  input: DirectFileUploadMetadata,
): Promise<DirectFileUploadPrepareResult> {
  if (!contextIsValid(context) || input.parentId !== context.parentId) {
    return { error: "Yükleme yetkilendirmesi geçersiz." };
  }
  const descriptor = validateDirectFileUploadMetadata(context.kind, input);
  if (!descriptor.ok) return { error: descriptor.error };

  const rateLimit = await checkRateLimit(
    `direct-file-upload-session:${context.tenantId}:${context.userId}:${context.kind}`,
    { limit: 100, windowSec: 10 * 60, failurePolicy: "deny" },
  );
  if (!rateLimit.allowed) {
    return { error: "Çok fazla dosya yükleme denemesi yapıldı. Lütfen daha sonra tekrar deneyin." };
  }

  const sessionId = crypto.randomUUID();
  const config = DIRECT_FILE_UPLOAD_CONFIG[context.kind];
  const storagePath = buildDirectFileUploadPath(
    context.tenantId,
    context.parentId,
    sessionId,
    descriptor.value.canonicalExtension,
  );
  const createdAt = Date.now();
  const finalizeBy = new Date(createdAt + DIRECT_FILE_UPLOAD_FINALIZE_TTL_MS);
  const providerExpiresAt = new Date(createdAt + DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS);
  const cleanupAfter = new Date(
    createdAt + DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS + DIRECT_FILE_UPLOAD_CLEANUP_BUFFER_MS,
  );
  const admin = createAdminClient();
  const { error: insertError } = await admin.from("direct_file_uploads").insert({
    id: sessionId,
    tenant_id: context.tenantId,
    kind: context.kind,
    customer_id: context.kind === "customer_file" ? context.parentId : null,
    property_id: context.kind === "property_media" ? context.parentId : null,
    // Sütun yalnız gider fişinde yazılır: 20261007000700 öncesi şemada diğer türler bozulmasın.
    ...(context.kind === "expense_receipt" ? { expense_id: context.parentId } : {}),
    requested_by: context.userId,
    bucket: config.bucket,
    storage_path: storagePath,
    file_name: descriptor.value.fileName,
    file_size: descriptor.value.fileSize,
    claimed_mime: descriptor.value.claimedMime,
    canonical_extension: descriptor.value.canonicalExtension,
    label: descriptor.value.label,
    has_watermark: descriptor.value.hasWatermark,
    status: "pending",
    finalize_expires_at: finalizeBy.toISOString(),
    signed_token_expires_at: providerExpiresAt.toISOString(),
    cleanup_after: cleanupAfter.toISOString(),
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(createdAt).toISOString(),
  });
  if (insertError) {
    console.error("prepareDirectFileUpload session insert", { code: insertError.code });
    return { error: "Güvenli yükleme oturumu oluşturulamadı." };
  }

  const { data: signed, error: signError } = await admin.storage
    .from(config.bucket)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (signError || !signed?.token || signed.path !== storagePath) {
    console.error("prepareDirectFileUpload signing", safeStorageError(signError));
    await admin
      .from("direct_file_uploads")
      .update({
        status: "blocked",
        blocked_reason: "signed_upload_creation_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("status", "pending");
    return { error: "Güvenli yükleme bağlantısı oluşturulamadı." };
  }

  return {
    ok: true,
    upload: {
      sessionId,
      bucket: config.bucket,
      path: storagePath,
      token: signed.token,
      contentType: descriptor.value.claimedMime,
      finalizeBy: finalizeBy.toISOString(),
    },
  };
}

async function updateOwnedLease(
  sessionId: string,
  leaseId: string,
  patch: Record<string, unknown>,
) {
  const admin = createAdminClient();
  await admin
    .from("direct_file_uploads")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "finalizing")
    .eq("lease_id", leaseId);
}

async function releaseDirectFileUploadLease(session: DirectFileUploadSession, leaseId: string) {
  const expired = new Date(session.finalize_expires_at).getTime() <= Date.now();
  await updateOwnedLease(session.id, leaseId, {
    status: expired ? "expired" : "pending",
    lease_id: null,
    lease_expires_at: null,
    blocked_reason: expired ? "finalize_window_expired" : null,
  });
}

async function blockDirectFileUpload(sessionId: string, leaseId: string, reason: string) {
  await updateOwnedLease(sessionId, leaseId, {
    status: "blocked",
    lease_id: null,
    lease_expires_at: null,
    blocked_reason: reason.slice(0, 200),
  });
}

function objectInfoSize(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const size = Number((value as { size?: unknown }).size);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function objectInfoContentType(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const contentType = (value as { contentType?: unknown }).contentType;
  if (typeof contentType !== "string") return null;
  return contentType.toLowerCase().split(";", 1)[0]?.trim() || null;
}

export async function finalizeDirectFileUpload(
  context: AuthorizedDirectFileUpload,
  sessionId: string,
): Promise<DirectFileUploadFinalizeResult> {
  if (!contextIsValid(context) || !isUuid(sessionId)) {
    return { error: "Yükleme oturumu geçersiz." };
  }

  const leaseId = crypto.randomUUID();
  const admin = createAdminClient();
  const { data, error: claimError } = await admin.rpc("claim_direct_file_upload", {
    p_session_id: sessionId,
    p_kind: context.kind,
    p_tenant_id: context.tenantId,
    p_parent_id: context.parentId,
    p_requested_by: context.userId,
    p_lease_id: leaseId,
  });
  if (claimError) {
    console.error("finalizeDirectFileUpload claim", { code: claimError.code });
    return { error: "Yükleme doğrulaması başlatılamadı." };
  }
  if (!data || typeof data !== "object") return { error: "Yükleme oturumu bulunamadı." };
  const session = data as unknown as DirectFileUploadSession;
  if (!sessionMatchesContext(session, context)) {
    console.error("finalizeDirectFileUpload unsafe session", { sessionId });
    return { error: "Yükleme oturumu güvenlik doğrulamasından geçemedi." };
  }

  if (session.status === "finalized") {
    const { data: replay, error: replayError } = await admin.rpc("finalize_direct_file_upload", {
      p_session_id: session.id,
      p_kind: context.kind,
      p_tenant_id: context.tenantId,
      p_parent_id: context.parentId,
      p_requested_by: context.userId,
      p_lease_id: leaseId,
      p_detected_mime: session.claimed_mime,
      p_detected_size: session.file_size,
    });
    if (replayError || !replay || typeof replay !== "object") {
      console.error("finalizeDirectFileUpload replay", { code: replayError?.code ?? null });
      return { error: "Tamamlanan yükleme doğrulanamadı." };
    }
    return { ok: true, id: session.id, created: false };
  }
  if (session.status === "expired") return { error: "Yükleme onay süresi doldu. Dosyayı yeniden seçin." };
  if (session.status === "blocked") return { error: "Dosya güvenlik doğrulamasından geçemedi." };
  if (session.status === "cleanup_queued") return { error: "Yükleme oturumu kapatıldı. Dosyayı yeniden seçin." };
  if (session.status !== "finalizing" || session.lease_id !== leaseId) {
    return { error: "Dosya başka bir işlemde doğrulanıyor. Birkaç saniye sonra yeniden deneyin." };
  }

  const config = DIRECT_FILE_UPLOAD_CONFIG[context.kind];
  const storage = admin.storage.from(config.bucket);
  const { data: info, error: infoError } = await storage.info(session.storage_path);
  if (infoError || !info) {
    console.error("finalizeDirectFileUpload object info", safeStorageError(infoError));
    await releaseDirectFileUploadLease(session, leaseId);
    return { error: "Yüklenen dosya henüz bulunamadı. Lütfen tekrar deneyin." };
  }
  const reportedSize = objectInfoSize(info);
  const reportedContentType = objectInfoContentType(info);
  if (
    reportedSize === null ||
    reportedSize <= 0 ||
    reportedSize > config.maxBytes ||
    reportedSize !== session.file_size ||
    (reportedContentType !== null && reportedContentType !== session.claimed_mime)
  ) {
    await blockDirectFileUpload(session.id, leaseId, "stored_object_metadata_mismatch");
    return { error: "Yüklenen dosyanın boyutu veya türü beklenen değerle eşleşmiyor." };
  }

  // The bucket itself enforces the same 10/15 MB ceiling. We check metadata
  // before download and the returned Blob again, so validation never accepts
  // an unbounded or swapped object even if metadata is stale.
  const { data: blob, error: downloadError } = await storage.download(session.storage_path);
  if (downloadError || !blob) {
    console.error("finalizeDirectFileUpload download", safeStorageError(downloadError));
    await releaseDirectFileUploadLease(session, leaseId);
    return { error: "Dosya doğrulama için indirilemedi. Lütfen tekrar deneyin." };
  }
  if (blob.size <= 0 || blob.size > config.maxBytes || blob.size !== session.file_size || blob.size !== reportedSize) {
    await blockDirectFileUpload(session.id, leaseId, "downloaded_object_size_mismatch");
    return { error: "Yüklenen dosyanın boyutu doğrulanamadı." };
  }

  const file = new File([blob], session.file_name, { type: session.claimed_mime });
  // Gider fişi görsel VEYA PDF olabildiği için belge doğrulayıcısı (imza + izinli tür listesi) kullanılır.
  const verified = context.kind === "property_media"
    ? await verifyImageFile(file, config.allowedMime)
    : await verifyDocumentFile(file, config.allowedMime);
  if (!verified.ok || verified.type !== session.claimed_mime) {
    await blockDirectFileUpload(session.id, leaseId, "signature_or_mime_verification_failed");
    return { error: verified.ok ? "Dosya içeriği ile bildirilen tür uyuşmuyor." : verified.error };
  }

  const { data: finalized, error: finalizeError } = await admin.rpc("finalize_direct_file_upload", {
    p_session_id: session.id,
    p_kind: context.kind,
    p_tenant_id: context.tenantId,
    p_parent_id: context.parentId,
    p_requested_by: context.userId,
    p_lease_id: leaseId,
    p_detected_mime: verified.type,
    p_detected_size: blob.size,
  });
  if (finalizeError || !finalized || typeof finalized !== "object") {
    console.error("finalizeDirectFileUpload metadata transaction", { code: finalizeError?.code ?? null });
    await releaseDirectFileUploadLease(session, leaseId);
    return { error: "Dosya doğrulandı ancak kaydedilemedi. Lütfen yeniden deneyin." };
  }

  const result = finalized as { id?: unknown; created?: unknown; status?: unknown };
  if (result.id !== session.id || result.status !== "finalized") {
    console.error("finalizeDirectFileUpload malformed rpc result", { sessionId });
    return { error: "Dosya kayıt sonucu doğrulanamadı." };
  }
  return { ok: true, id: session.id, created: result.created === true };
}
