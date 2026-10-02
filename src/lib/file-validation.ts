/**
 * File validation and filename/header normalization shared by private uploads.
 * Client-provided MIME types, extensions and filenames are all untrusted.
 * "Validation" here means bounded signature/MIME/container checks only. No
 * malware engine is configured, so a successful result is never a clean/AV
 * verdict and callers must not present it as one.
 */

export type DetectedImage = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export type DetectedDocument =
  | DetectedImage
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.ms-excel"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const DOCUMENT_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
} as const satisfies Record<DetectedDocument, string>;

export type VerifyResult = { ok: true; type: DetectedImage } | { ok: false; error: string };
export type VerifyDocumentResult =
  | { ok: true; type: DetectedDocument }
  | { ok: false; error: string };

const IMAGE_TYPES = new Set<DetectedDocument>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const OLE_DOCUMENT_TYPES = new Set<DetectedDocument>([
  "application/msword",
  "application/vnd.ms-excel",
]);
const CONTROL_AND_BIDI_RE =
  /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;

function hasSignature(bytes: Uint8Array, signature: readonly number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function endsWithSignature(bytes: Uint8Array, signature: readonly number[]) {
  return hasSignature(bytes, signature, bytes.length - signature.length);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string) {
  if (offset < 0 || bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function dataView(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

export function normalizeDocumentMime(value: unknown): DetectedDocument | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return Object.hasOwn(DOCUMENT_MIME_EXTENSIONS, normalized)
    ? (normalized as DetectedDocument)
    : null;
}

export function canonicalExtensionForMime(type: DetectedDocument) {
  return DOCUMENT_MIME_EXTENSIONS[type];
}

/** Binds an admin-storage operation to the authorized tenant and parent row. */
export function isSafeTenantObjectPath(path: unknown, tenantId: string, parentId: string) {
  if (typeof path !== "string") return false;
  const prefix = `${tenantId}/${parentId}/`;
  if (!path.startsWith(prefix) || path.includes("..") || path.includes("\\")) return false;
  return /^[a-z0-9][a-z0-9._-]{0,199}$/i.test(path.slice(prefix.length));
}

function stripUnpairedSurrogates(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? "" : character;
  }).join("");
}

function cleanFileName(value: unknown, fallback: string) {
  const normalized = stripUnpairedSurrogates(String(value ?? ""))
    .normalize("NFKC")
    .replace(CONTROL_AND_BIDI_RE, " ")
    .replace(/[\\/<>:"|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return normalized || fallback;
}

function truncateCodePoints(value: string, limit: number) {
  return Array.from(value).slice(0, limit).join("").trim();
}

/** Produces a portable display name whose extension matches signature-checked bytes. */
export function normalizeUploadedFileName(originalName: unknown, type: DetectedDocument) {
  const extension = canonicalExtensionForMime(type);
  const cleaned = cleanFileName(originalName, "dosya");
  const withoutExtension = cleaned.replace(/\.[^.]{1,16}$/u, "").trim();
  const base = truncateCodePoints(withoutExtension || "dosya", 140) || "dosya";
  return `${base}.${extension}`;
}

/** Unknown legacy types deliberately lose their executable-looking extension. */
export function normalizeDownloadFileName(
  originalName: unknown,
  type: DetectedDocument | null,
) {
  if (type) return normalizeUploadedFileName(originalName, type);
  const cleaned = cleanFileName(originalName, "belge");
  const withoutExtension = cleaned.replace(/\.[^.]{1,16}$/u, "").trim();
  const base = truncateCodePoints(withoutExtension || "belge", 140) || "belge";
  return `${base}.bin`;
}

/** Builds an RFC 6266/5987-safe Content-Disposition value with an ASCII fallback. */
export function buildContentDisposition(
  disposition: "inline" | "attachment",
  safeFileName: string,
) {
  const normalized = cleanFileName(safeFileName, "belge.bin");
  const fallback = normalized
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "-")
    .trim()
    .slice(0, 120) || "belge.bin";
  const encoded = encodeURIComponent(normalized).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Detects an image family by its leading bytes. Full validation is separate. */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (hasSignature(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return "image/gif";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

function detectCompleteImageType(bytes: Uint8Array): DetectedImage | null {
  const detected = detectImageType(bytes);
  if (detected === "image/jpeg") {
    return bytes.length >= 4 && endsWithSignature(bytes, [0xff, 0xd9]) ? detected : null;
  }
  if (detected === "image/png") {
    return bytes.length >= 20 && asciiAt(bytes, bytes.length - 8, "IEND") ? detected : null;
  }
  if (detected === "image/gif") {
    return bytes.length >= 14 && bytes[bytes.length - 1] === 0x3b ? detected : null;
  }
  if (detected === "image/webp") {
    if (bytes.length < 20) return null;
    const declaredLength = dataView(bytes).getUint32(4, true) + 8;
    const validChunk = asciiAt(bytes, 12, "VP8 ") || asciiAt(bytes, 12, "VP8L") || asciiAt(bytes, 12, "VP8X");
    return declaredLength === bytes.length && validChunk ? detected : null;
  }
  return null;
}

type ZipEntry = { name: string; uncompressedSize: number };

function findZipEnd(bytes: Uint8Array) {
  if (bytes.length < 22) return -1;
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (!hasSignature(bytes, [0x50, 0x4b, 0x05, 0x06], offset)) continue;
    const view = dataView(bytes);
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  return -1;
}

/** Parses only the bounded ZIP directory metadata needed to identify OOXML. */
function readZipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const endOffset = findZipEnd(bytes);
  if (endOffset < 0) return null;

  const view = dataView(bytes);
  const disk = view.getUint16(endOffset + 4, true);
  const directoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const directorySize = view.getUint32(endOffset + 12, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > 10_000 ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff ||
    directoryOffset + directorySize > endOffset
  ) {
    return null;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  try {
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.length || !hasSignature(bytes, [0x50, 0x4b, 0x01, 0x02], offset)) {
        return null;
      }
      const flags = view.getUint16(offset + 8, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
      if (
        (flags & 0x0001) !== 0 ||
        nameLength === 0 ||
        nextOffset > bytes.length ||
        localOffset + 30 > directoryOffset ||
        !hasSignature(bytes, [0x50, 0x4b, 0x03, 0x04], localOffset)
      ) {
        return null;
      }

      const localFlags = view.getUint16(localOffset + 6, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const localNameEnd = localOffset + 30 + localNameLength;
      if (
        (localFlags & 0x0001) !== 0 ||
        localNameEnd + localExtraLength > directoryOffset ||
        localNameLength !== nameLength
      ) {
        return null;
      }

      const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
      const localNameBytes = bytes.slice(localOffset + 30, localNameEnd);
      const name = decoder.decode(nameBytes);
      const localName = decoder.decode(localNameBytes);
      if (
        name !== localName ||
        name.startsWith("/") ||
        name.includes("\\") ||
        name.split("/").includes("..") ||
        name.includes("\u0000")
      ) {
        return null;
      }

      entries.push({ name, uncompressedSize });
      offset = nextOffset;
    }
  } catch {
    return null;
  }

  return offset === directoryOffset + directorySize ? entries : null;
}

function detectOoxmlType(bytes: Uint8Array): DetectedDocument | null {
  const entries = readZipEntries(bytes);
  if (!entries) return null;
  const entryMap = new Map(entries.map((entry) => [entry.name, entry.uncompressedSize]));
  const requiredBase = ["[Content_Types].xml", "_rels/.rels"];
  if (requiredBase.some((name) => !entryMap.get(name))) return null;

  const word = Boolean(entryMap.get("word/document.xml"));
  const spreadsheet = Boolean(entryMap.get("xl/workbook.xml"));
  if (word === spreadsheet) return null;
  if (word && entryMap.has("word/vbaProject.bin")) return null;
  if (spreadsheet && entryMap.has("xl/vbaProject.bin")) return null;
  return word
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function containsUtf16Le(bytes: Uint8Array, text: string) {
  const encoded = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    encoded[index * 2] = text.charCodeAt(index);
  }
  outer: for (let offset = 0; offset <= bytes.length - encoded.length; offset += 2) {
    for (let index = 0; index < encoded.length; index += 1) {
      if (bytes[offset + index] !== encoded[index]) continue outer;
    }
    return true;
  }
  return false;
}

function isOleDocument(bytes: Uint8Array, claimed: DetectedDocument) {
  if (
    bytes.length < 512 ||
    !hasSignature(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  ) {
    return false;
  }
  const view = dataView(bytes);
  const majorVersion = view.getUint16(26, true);
  const byteOrder = view.getUint16(28, true);
  const sectorShift = view.getUint16(30, true);
  const miniSectorShift = view.getUint16(32, true);
  const expectedSectorShift = majorVersion === 3 ? 9 : majorVersion === 4 ? 12 : -1;
  if (
    byteOrder !== 0xfffe ||
    sectorShift !== expectedSectorShift ||
    miniSectorShift !== 6 ||
    bytes.length % (1 << sectorShift) !== 0
  ) {
    return false;
  }
  if (claimed === "application/msword") return containsUtf16Le(bytes, "WordDocument");
  if (claimed === "application/vnd.ms-excel") {
    return containsUtf16Le(bytes, "Workbook") || containsUtf16Le(bytes, "Book");
  }
  return false;
}

export async function verifyImageFile(file: File, allowed: readonly string[]): Promise<VerifyResult> {
  if (!isFile(file) || file.size <= 0) return { ok: false, error: "Geçerli ve boş olmayan bir dosya seçin." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectCompleteImageType(bytes);
  if (!detected) return { ok: false, error: "Dosya geçerli ve tamamlanmış bir görsel değil." };
  if (!allowed.includes(detected)) return { ok: false, error: "Desteklenmeyen görsel türü." };
  return { ok: true, type: detected };
}

/**
 * Detects actual customer-document bytes and requires them to match the
 * allowlisted client claim. OOXML ZIPs must contain their canonical package
 * directory; a generic ZIP header is never sufficient.
 */
export async function verifyDocumentFile(
  file: File,
  allowed: readonly string[],
): Promise<VerifyDocumentResult> {
  if (!isFile(file) || file.size <= 0) return { ok: false, error: "Geçerli ve boş olmayan bir dosya seçin." };
  const claimed = normalizeDocumentMime(file.type);
  if (!claimed || !allowed.includes(claimed)) return { ok: false, error: "Desteklenmeyen dosya tipi." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectCompleteImageType(bytes);
  if (image) {
    return image === claimed && IMAGE_TYPES.has(claimed)
      ? { ok: true, type: image }
      : { ok: false, error: "Dosya içeriği ile bildirilen tür uyuşmuyor." };
  }

  if (hasSignature(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    const tail = new TextDecoder("latin1").decode(bytes.slice(Math.max(0, bytes.length - 1024)));
    if (!tail.includes("%%EOF")) return { ok: false, error: "PDF dosyası eksik veya bozuk." };
    return claimed === "application/pdf"
      ? { ok: true, type: claimed }
      : { ok: false, error: "Dosya içeriği ile bildirilen tür uyuşmuyor." };
  }

  if (hasSignature(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const ooxml = detectOoxmlType(bytes);
    if (!ooxml) return { ok: false, error: "Office paketi doğrulanamadı." };
    return ooxml === claimed
      ? { ok: true, type: ooxml }
      : { ok: false, error: "Dosya içeriği ile bildirilen tür uyuşmuyor." };
  }

  if (hasSignature(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return OLE_DOCUMENT_TYPES.has(claimed) && isOleDocument(bytes, claimed)
      ? { ok: true, type: claimed }
      : { ok: false, error: "Office dosya yapısı doğrulanamadı." };
  }

  return { ok: false, error: "Dosya içeriği doğrulanamadı." };
}
