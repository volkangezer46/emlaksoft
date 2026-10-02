import { describe, expect, it } from "vitest";
import {
  buildContentDisposition,
  canonicalExtensionForMime,
  normalizeDownloadFileName,
  normalizeUploadedFileName,
  verifyDocumentFile,
  verifyImageFile,
} from "@/lib/file-validation";

const allowed = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

function upload(bytes: Uint8Array | string, name: string, type: string) {
  const part = typeof bytes === "string" ? bytes : Uint8Array.from(bytes).buffer;
  return new File([part], name, { type });
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function storedZip(entries: string[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entryName of entries) {
    const name = encoder.encode(entryName);
    const body = new Uint8Array([0x78]);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, body.length, true);
    localView.setUint16(26, name.length, true);
    localParts.push(local, name, body);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, body.length, true);
    centralView.setUint32(24, body.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    centralParts.push(central, name);
    localOffset += local.length + name.length + body.length;
  }

  const directory = concat(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, localOffset, true);
  return concat([...localParts, directory, end]);
}

function legacyOffice(streamName: "WordDocument" | "Workbook") {
  const bytes = new Uint8Array(512);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  Array.from(streamName).forEach((character, index) => {
    view.setUint16(128 + index * 2, character.charCodeAt(0), true);
  });
  return bytes;
}

describe("customer document signature verification", () => {
  it("accepts a structurally bounded PDF signature", async () => {
    const result = await verifyDocumentFile(
      upload("%PDF-1.7\n1 0 obj\nendobj\n%%EOF", "rapor.pdf", "application/pdf"),
      allowed,
    );
    expect(result).toEqual({ ok: true, type: "application/pdf" });
  });

  it("rejects active content masquerading as PDF and empty runtime input", async () => {
    const active = await verifyDocumentFile(
      upload("<html><script>alert(1)</script></html>", "rapor.pdf", "application/pdf"),
      allowed,
    );
    const empty = await verifyDocumentFile(upload("", "bos.pdf", "application/pdf"), allowed);
    const nonFile = await verifyDocumentFile("bad" as unknown as File, allowed);
    expect(active.ok).toBe(false);
    expect(empty.ok).toBe(false);
    expect(nonFile.ok).toBe(false);
  });

  it("requires canonical OOXML directory entries instead of a generic ZIP header", async () => {
    const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const valid = await verifyDocumentFile(
      upload(storedZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]), "not.docx", mime),
      allowed,
    );
    const genericZip = await verifyDocumentFile(
      upload(storedZip(["payload.html"]), "not.docx", mime),
      allowed,
    );
    const macroPackage = await verifyDocumentFile(
      upload(
        storedZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/vbaProject.bin"]),
        "not.docx",
        mime,
      ),
      allowed,
    );
    expect(valid).toEqual({ ok: true, type: mime });
    expect(genericZip.ok).toBe(false);
    expect(macroPackage.ok).toBe(false);
  });

  it("distinguishes DOCX and XLSX package roots", async () => {
    const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const bytes = storedZip(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]);
    const xlsx = await verifyDocumentFile(upload(bytes, "tablo.xlsx", xlsxMime), allowed);
    const spoofedDocx = await verifyDocumentFile(
      upload(bytes, "tablo.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      allowed,
    );
    expect(xlsx).toEqual({ ok: true, type: xlsxMime });
    expect(spoofedDocx.ok).toBe(false);
  });

  it("requires a bounded OLE header and the expected legacy Office stream", async () => {
    const valid = await verifyDocumentFile(
      upload(legacyOffice("Workbook"), "tablo.xls", "application/vnd.ms-excel"),
      allowed,
    );
    const wrongStream = await verifyDocumentFile(
      upload(legacyOffice("WordDocument"), "tablo.xls", "application/vnd.ms-excel"),
      allowed,
    );
    const bareMagic = await verifyDocumentFile(
      upload(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "tablo.xls", "application/vnd.ms-excel"),
      allowed,
    );
    expect(valid).toEqual({ ok: true, type: "application/vnd.ms-excel" });
    expect(wrongStream.ok).toBe(false);
    expect(bareMagic.ok).toBe(false);
  });

  it("rejects an incomplete image and a claimed image with a different signature", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
    const mismatch = await verifyDocumentFile(upload(jpeg, "foto.png", "image/png"), allowed);
    const trailingHtml = await verifyImageFile(
      upload(new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode("<html>")]), "foto.jpg", "image/jpeg"),
      ["image/jpeg"],
    );
    expect(mismatch.ok).toBe(false);
    expect(trailingHtml.ok).toBe(false);
  });
});

describe("canonical file names and response headers", () => {
  it("derives storage extensions from verified MIME instead of user input", () => {
    expect(canonicalExtensionForMime("image/jpeg")).toBe("jpg");
    expect(
      normalizeUploadedFileName("../kimlik.html\u202Egnp", "application/pdf"),
    ).toBe("-kimlik.pdf");
    expect(normalizeDownloadFileName("payload.html", null)).toBe("payload.bin");
  });

  it("removes control/path characters and emits an injection-safe disposition", () => {
    const safeName = normalizeUploadedFileName(
      "rapor\"\r\nX-Evil: yes/son.html",
      "application/pdf",
    );
    const header = buildContentDisposition("attachment", safeName);
    expect(safeName.endsWith(".pdf")).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain("X-Evil:");
  });
});
