import {
  canonicalExtensionForMime,
  isSafeTenantObjectPath,
  normalizeDocumentMime,
  normalizeUploadedFileName,
  type DetectedDocument,
} from "@/lib/file-validation";

export type DirectFileUploadKind = "customer_file" | "property_media" | "expense_receipt";

/** Doğrudan yükleme kovaları (özel). Tür → kova eşlemesi `DIRECT_FILE_UPLOAD_CONFIG`. */
export type DirectFileUploadBucket = "customer-files" | "property-media" | "expense-receipts";

export type DirectFileUploadMetadata = {
  parentId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  label?: string | null;
  hasWatermark?: boolean;
};

export type ValidDirectFileUpload = {
  fileName: string;
  fileSize: number;
  claimedMime: DetectedDocument;
  canonicalExtension: string;
  label: string | null;
  hasWatermark: boolean;
};

export type DirectFileUploadTarget = {
  sessionId: string;
  bucket: DirectFileUploadBucket;
  path: string;
  token: string;
  contentType: DetectedDocument;
  finalizeBy: string;
};

export type DirectFileUploadPrepareResult =
  | { ok: true; upload: DirectFileUploadTarget }
  | { ok?: false; error: string };

export type DirectFileUploadFinalizeResult =
  | { ok: true; id: string; created: boolean }
  | { ok?: false; error: string };

export const DIRECT_FILE_UPLOAD_CONFIG = {
  customer_file: {
    bucket: "customer-files",
    maxBytes: 10 * 1024 * 1024,
    allowedMime: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ] as readonly DetectedDocument[],
    cacheControl: "3600",
  },
  property_media: {
    bucket: "property-media",
    maxBytes: 15 * 1024 * 1024,
    allowedMime: ["image/jpeg", "image/png", "image/gif", "image/webp"] as readonly DetectedDocument[],
    cacheControl: "31536000",
  },
  // Gider fişi (20261007000700): görsel veya PDF, 10 MB; okuma yalnız sunucu indirme ucundan.
  expense_receipt: {
    bucket: "expense-receipts",
    maxBytes: 10 * 1024 * 1024,
    allowedMime: ["image/jpeg", "image/png", "image/webp", "application/pdf"] as readonly DetectedDocument[],
    cacheControl: "3600",
  },
} as const;

/** Kova adından yükleme ayarı (istemci yükleyicisi için tek eşleme). */
export function directUploadConfigForBucket(bucket: DirectFileUploadBucket) {
  if (bucket === "customer-files") return DIRECT_FILE_UPLOAD_CONFIG.customer_file;
  if (bucket === "expense-receipts") return DIRECT_FILE_UPLOAD_CONFIG.expense_receipt;
  return DIRECT_FILE_UPLOAD_CONFIG.property_media;
}

export const DIRECT_FILE_UPLOAD_FINALIZE_TTL_MS = 15 * 60 * 1000;
// Supabase Storage signed-upload tokens currently have a fixed two-hour TTL.
export const DIRECT_FILE_UPLOAD_PROVIDER_TTL_MS = 2 * 60 * 60 * 1000;
export const DIRECT_FILE_UPLOAD_CLEANUP_BUFFER_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_AND_BIDI_RE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizeLabel(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || CONTROL_AND_BIDI_RE.test(value)) return { ok: false };
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized || Array.from(normalized).length > 200) return { ok: false };
  return { ok: true, value: normalized };
}

/**
 * Validates only the small upload request envelope. Browser MIME/name metadata
 * remains provisional; finalize must inspect the stored bytes before creating
 * relational metadata.
 */
export function validateDirectFileUploadMetadata(
  kind: DirectFileUploadKind,
  input: DirectFileUploadMetadata,
): { ok: true; value: ValidDirectFileUpload } | { ok: false; error: string } {
  const config = DIRECT_FILE_UPLOAD_CONFIG[kind];
  if (!isUuid(input.parentId)) {
    return {
      ok: false,
      error: kind === "customer_file" ? "Geçerli bir müşteri seçin." : kind === "expense_receipt" ? "Geçerli bir gider seçin." : "Geçerli bir portföy seçin.",
    };
  }
  if (!Number.isSafeInteger(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: "Boş veya geçersiz dosya yüklenemez." };
  }
  if (input.fileSize > config.maxBytes) {
    const maxMb = Math.round(config.maxBytes / 1024 / 1024);
    return { ok: false, error: `Dosya çok büyük (maksimum ${maxMb} MB).` };
  }
  if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.length > 255) {
    return { ok: false, error: "Geçerli bir dosya adı girin." };
  }

  const claimedMime = normalizeDocumentMime(input.fileType);
  if (!claimedMime || !config.allowedMime.includes(claimedMime)) {
    return {
      ok: false,
      error: kind === "property_media"
        ? "Desteklenmeyen görsel türü."
        : kind === "expense_receipt"
          ? "Fiş için JPEG, PNG, WEBP görsel veya PDF yükleyin."
          : "Desteklenmeyen dosya tipi.",
    };
  }
  const label = normalizeLabel(input.label);
  if (!label.ok) return { ok: false, error: "Dosya etiketi geçersiz veya çok uzun." };
  if (kind !== "customer_file" && label.value !== null) {
    return { ok: false, error: "Görsel yüklemesinde dosya etiketi kullanılamaz." };
  }

  return {
    ok: true,
    value: {
      fileName: normalizeUploadedFileName(input.fileName, claimedMime),
      fileSize: input.fileSize,
      claimedMime,
      canonicalExtension: canonicalExtensionForMime(claimedMime),
      label: kind === "customer_file" ? label.value : null,
      hasWatermark: kind === "property_media" && input.hasWatermark === true,
    },
  };
}

export function buildDirectFileUploadPath(
  tenantId: string,
  parentId: string,
  sessionId: string,
  extension: string,
) {
  if (!isUuid(tenantId) || !isUuid(parentId) || !isUuid(sessionId)) {
    throw new Error("invalid_direct_upload_path_identity");
  }
  if (!/^(jpg|png|gif|webp|pdf|doc|docx|xls|xlsx)$/.test(extension)) {
    throw new Error("invalid_direct_upload_extension");
  }
  return `${tenantId}/${parentId}/${sessionId}.${extension}`;
}

export function isSafeDirectFileUploadPath(input: {
  path: unknown;
  tenantId: string;
  parentId: string;
  sessionId: string;
  extension: string;
}) {
  if (!isSafeTenantObjectPath(input.path, input.tenantId, input.parentId)) return false;
  try {
    return input.path === buildDirectFileUploadPath(
      input.tenantId,
      input.parentId,
      input.sessionId,
      input.extension,
    );
  } catch {
    return false;
  }
}
