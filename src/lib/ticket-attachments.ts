/**
 * Destek talebi ekleri için tek dosya-güvenliği kaynağı.
 *
 * Tarayıcının bildirdiği MIME ve dosya uzantısı güvenilir değildir. Bu
 * yardımcı dosyanın gerçek baytlarını denetler, aktif içerikleri reddeder,
 * adını normalize eder ve bütünlük özetini üretir. Hem Route Handler hem de
 * birim testleri aynı sözleşmeyi kullanır.
 */

export const TICKET_ATTACHMENT_BUCKET = "ticket-attachments";
export const TICKET_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const TICKET_ATTACHMENT_MAX_FILES = 5;
export const TICKET_ATTACHMENT_ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,application/pdf,image/jpeg,image/png,image/webp,text/plain,text/csv";

export const TICKET_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
] as const;

export type TicketAttachmentMime = (typeof TICKET_ATTACHMENT_MIME_TYPES)[number];
export type TicketAttachmentVisibility = "public" | "internal";
// `signature_verified` is deliberately not called clean: no malware engine is
// configured. It means only signature/MIME/structure/SHA-256 validation passed.
export type TicketAttachmentStatus = "signature_verified" | "blocked";

export type TicketAttachmentRecord = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  message_id: string | null;
  uploaded_by: string | null;
  uploaded_by_kind: "tenant" | "staff" | "system";
  visibility: TicketAttachmentVisibility;
  file_name: string;
  storage_path: string;
  mime_type: TicketAttachmentMime;
  file_size: number;
  sha256: string;
  scan_status: TicketAttachmentStatus;
  blocked_reason: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type VerifiedTicketAttachment = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: TicketAttachmentMime;
  extension: "pdf" | "jpg" | "png" | "webp" | "txt" | "csv";
  size: number;
  sha256: string;
};

export type TicketAttachmentVerification =
  | { ok: true; value: VerifiedTicketAttachment }
  | { ok: false; error: string };

export type TicketAttachmentUploadDescriptor = {
  fileName: string;
  claimedMime: TicketAttachmentMime;
  extension: VerifiedTicketAttachment["extension"];
  size: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function endsWith(bytes: Uint8Array, signature: readonly number[]) {
  if (bytes.length < signature.length) return false;
  const offset = bytes.length - signature.length;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string) {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function isProbablyUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) return false;
    let suspicious = 0;
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) suspicious += 1;
    }
    return suspicious === 0;
  } catch {
    return false;
  }
}

export function detectTicketAttachmentType(
  bytes: Uint8Array,
  claimedType: string,
  originalName: string,
): { mimeType: TicketAttachmentMime; extension: VerifiedTicketAttachment["extension"] } | null {
  if (bytes.length >= 8 && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    // PDF başlığına ek olarak son 1 KiB içinde EOF işareti aranır.
    const tail = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.length - 1024)));
    return tail.includes("%%EOF") ? { mimeType: "application/pdf", extension: "pdf" } : null;
  }
  if (bytes.length >= 4 && startsWith(bytes, [0xff, 0xd8, 0xff]) && endsWith(bytes, [0xff, 0xd9])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 20 &&
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
    // IEND chunk türü son 12 baytın 4–7 aralığındadır.
    asciiAt(bytes, bytes.length - 8, "IEND")
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  if (!isProbablyUtf8Text(bytes)) return null;
  const lowerName = originalName.toLocaleLowerCase("tr-TR");
  const lowerType = claimedType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const csv = lowerType === "text/csv" || lowerName.endsWith(".csv");
  return csv
    ? { mimeType: "text/csv", extension: "csv" }
    : { mimeType: "text/plain", extension: "txt" };
}

function claimedTypeMatches(claimedType: string, detected: TicketAttachmentMime) {
  const claimed = claimedType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (!claimed) return true;
  if (claimed === detected) return true;
  // Bazı tarayıcılar CSV'yi plain text olarak bildirir.
  return detected === "text/csv" && claimed === "text/plain";
}

/** Path segmenti olabilecek, görselde de okunabilir güvenli dosya adı. */
export function normalizeTicketAttachmentName(
  originalName: string,
  extension: VerifiedTicketAttachment["extension"],
): string {
  const normalized = originalName
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const withoutExtension = normalized.replace(/\.[a-z0-9]{1,10}$/i, "").trim();
  const base = (withoutExtension || "dosya").slice(0, 140).trim();
  return `${base}.${extension}`;
}

/** Signed-upload oturumu için yalnız kaba allowlist. Gerçek karar finalize
 * aşamasında private nesnenin baytları `verifyTicketAttachment` ile okununca verilir. */
export function prepareTicketAttachmentUploadDescriptor(input: {
  name: string;
  type: string;
  size: number;
}): { ok: true; value: TicketAttachmentUploadDescriptor } | { ok: false; error: string } {
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return { ok: false, error: "Boş dosya yüklenemez." };
  if (input.size > TICKET_ATTACHMENT_MAX_BYTES) return { ok: false, error: "Her dosya en fazla 10 MB olabilir." };

  const lowerName = input.name.normalize("NFKC").toLocaleLowerCase("tr-TR");
  const rawType = input.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  let detected: { claimedMime: TicketAttachmentMime; extension: VerifiedTicketAttachment["extension"] } | null = null;

  if (rawType === "application/pdf" || (!rawType && lowerName.endsWith(".pdf"))) {
    detected = { claimedMime: "application/pdf", extension: "pdf" };
  } else if (rawType === "image/jpeg" || rawType === "image/jpg" || (!rawType && /\.jpe?g$/.test(lowerName))) {
    detected = { claimedMime: "image/jpeg", extension: "jpg" };
  } else if (rawType === "image/png" || (!rawType && lowerName.endsWith(".png"))) {
    detected = { claimedMime: "image/png", extension: "png" };
  } else if (rawType === "image/webp" || (!rawType && lowerName.endsWith(".webp"))) {
    detected = { claimedMime: "image/webp", extension: "webp" };
  } else if (
    rawType === "text/csv" ||
    rawType === "application/csv" ||
    rawType === "application/vnd.ms-excel" ||
    (!rawType && lowerName.endsWith(".csv"))
  ) {
    detected = { claimedMime: "text/csv", extension: "csv" };
  } else if (rawType === "text/plain" || (!rawType && lowerName.endsWith(".txt"))) {
    detected = { claimedMime: "text/plain", extension: "txt" };
  }

  if (!detected) return { ok: false, error: "Yalnız PDF, JPEG, PNG, WebP, TXT ve CSV dosyaları yüklenebilir." };
  return {
    ok: true,
    value: {
      fileName: normalizeTicketAttachmentName(input.name, detected.extension),
      claimedMime: detected.claimedMime,
      extension: detected.extension,
      size: input.size,
    },
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyTicketAttachment(file: File): Promise<TicketAttachmentVerification> {
  if (!(file instanceof File)) return { ok: false, error: "Geçerli bir dosya seçin." };
  if (file.size <= 0) return { ok: false, error: "Boş dosya yüklenemez." };
  if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "Her dosya en fazla 10 MB olabilir." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectTicketAttachmentType(bytes, file.type, file.name);
  if (!detected) {
    return { ok: false, error: "Dosya içeriği doğrulanamadı veya bu dosya türü desteklenmiyor." };
  }
  if (!claimedTypeMatches(file.type, detected.mimeType)) {
    return { ok: false, error: "Dosyanın içeriği ile bildirilen türü uyuşmuyor." };
  }

  const sha256 = await sha256Hex(bytes);
  if (!SHA256_RE.test(sha256)) return { ok: false, error: "Dosya bütünlüğü doğrulanamadı." };

  return {
    ok: true,
    value: {
      bytes,
      fileName: normalizeTicketAttachmentName(file.name, detected.extension),
      mimeType: detected.mimeType,
      extension: detected.extension,
      size: file.size,
      sha256,
    },
  };
}

export function buildTicketAttachmentPath(
  tenantId: string,
  ticketId: string,
  attachmentId: string,
  extension: VerifiedTicketAttachment["extension"],
) {
  if (![tenantId, ticketId, attachmentId].every(isUuid)) throw new Error("Geçersiz ek dosya yolu kimliği.");
  return `${tenantId.toLowerCase()}/${ticketId.toLowerCase()}/${attachmentId.toLowerCase()}.${extension}`;
}

/** Kullanıcı girdisinden gelebilecek path traversal ve bucket kaçışını keser. */
export function isSafeTicketAttachmentPath(path: string, tenantId: string, ticketId: string): boolean {
  if (!isUuid(tenantId) || !isUuid(ticketId) || path.includes("..") || path.includes("\\")) return false;
  const escapedTenant = tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTicket = ticketId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escapedTenant}/${escapedTicket}/[0-9a-f-]{36}\\.(pdf|jpg|png|webp|txt|csv)$`,
    "i",
  ).test(path);
}

export function attachmentDownloadHref(id: string) {
  if (!isUuid(id)) return "#";
  return `/api/ticket-attachments/${id}`;
}

export function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
