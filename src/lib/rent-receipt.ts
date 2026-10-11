import {
  canonicalExtensionForMime,
  normalizeDocumentMime,
  normalizeUploadedFileName,
  type DetectedDocument,
} from "@/lib/file-validation";

/** Kiracı "Ödedim" dekontu: özel kova, 5 MB, yalnız JPEG/PNG/PDF. Sunucu ve istemci aynı sınırı kullanır. */
export const RENT_RECEIPT_BUCKET = "rent-receipts";
export const RENT_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RENT_RECEIPT_MIME = ["image/jpeg", "image/png", "application/pdf"] as const satisfies readonly DetectedDocument[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRentReceiptUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type RentReceiptMeta = { fileName: string; fileSize: number; mime: (typeof RENT_RECEIPT_MIME)[number]; extension: string };

/** Küçük istek zarfı doğrulaması (baytlar sonradan finalize'da denetlenir). */
export function validateRentReceiptMeta(input: {
  fileName: unknown;
  fileSize: unknown;
  fileType: unknown;
}): { ok: true; value: RentReceiptMeta } | { ok: false; error: string } {
  const size = input.fileSize;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, error: "Boş veya geçersiz dosya yüklenemez." };
  }
  if (size > RENT_RECEIPT_MAX_BYTES) return { ok: false, error: "Dekont en fazla 5 MB olabilir." };
  if (typeof input.fileName !== "string" || !input.fileName.trim() || input.fileName.length > 255) {
    return { ok: false, error: "Geçerli bir dosya adı girin." };
  }
  const mime = normalizeDocumentMime(input.fileType);
  if (!mime || !(RENT_RECEIPT_MIME as readonly string[]).includes(mime)) {
    return { ok: false, error: "Dekont için JPEG, PNG görsel veya PDF yükleyin." };
  }
  return {
    ok: true,
    value: {
      fileName: normalizeUploadedFileName(input.fileName, mime),
      fileSize: size,
      mime: mime as RentReceiptMeta["mime"],
      extension: canonicalExtensionForMime(mime),
    },
  };
}

/** Yol: ofis / kiracı (müşteri) / bildirim / dosya. Kimlikler token'ın çözdüğü kayıttan gelir, istemciden değil. */
export function buildRentReceiptPath(tenantId: string, customerId: string, noticeId: string, fileId: string, extension: string): string {
  if (![tenantId, customerId, noticeId, fileId].every(isRentReceiptUuid)) throw new Error("invalid_rent_receipt_path_identity");
  if (!/^(jpg|png|pdf)$/.test(extension)) throw new Error("invalid_rent_receipt_extension");
  return `${tenantId}/${customerId}/${noticeId}/${fileId}.${extension}`;
}
