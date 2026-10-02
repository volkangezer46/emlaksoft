import { describe, expect, it } from "vitest";
import {
  buildTicketAttachmentPath,
  detectTicketAttachmentType,
  isSafeTicketAttachmentPath,
  normalizeTicketAttachmentName,
  prepareTicketAttachmentUploadDescriptor,
  verifyTicketAttachment,
} from "@/lib/ticket-attachments";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT = "33333333-3333-4333-8333-333333333333";

function file(bytes: number[] | Uint8Array, name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("ticket attachment byte verification", () => {
  it("PDF başlığı ve EOF işareti olmadan dosyayı kabul etmez", async () => {
    const invalid = await verifyTicketAttachment(file([0x25, 0x50, 0x44, 0x46, 0x2d], "rapor.pdf", "application/pdf"));
    expect(invalid.ok).toBe(false);

    const valid = await verifyTicketAttachment(
      new File(["%PDF-1.7\n1 0 obj\n%%EOF\n"], "rapor.pdf", { type: "application/pdf" }),
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.mimeType).toBe("application/pdf");
      expect(valid.value.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("JPEG imzası ile bildirilen MIME uyuşmiyorsa bloklar", async () => {
    const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9];
    const valid = await verifyTicketAttachment(file(bytes, "foto.jpg", "image/jpeg"));
    expect(valid.ok).toBe(true);

    const spoofed = await verifyTicketAttachment(file(bytes, "foto.png", "image/png"));
    expect(spoofed.ok).toBe(false);
  });

  it("PNG ve WebP imzalarını ayırt eder", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(detectTicketAttachmentType(png, "image/png", "a.png")?.mimeType).toBe("image/png");

    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectTicketAttachmentType(webp, "image/webp", "a.webp")?.mimeType).toBe("image/webp");
  });

  it("UTF-8 TXT/CSV kabul eder; NUL veya ikili içeriği reddeder", async () => {
    const text = await verifyTicketAttachment(new File(["Merhaba dünya\n"], "not.txt", { type: "text/plain" }));
    expect(text.ok).toBe(true);

    const csv = await verifyTicketAttachment(new File(["ad,telefon\nAyşe,555\n"], "liste.csv", { type: "text/csv" }));
    expect(csv.ok).toBe(true);
    if (csv.ok) expect(csv.value.mimeType).toBe("text/csv");

    const binary = await verifyTicketAttachment(file([0x41, 0, 0x42], "zararli.txt", "text/plain"));
    expect(binary.ok).toBe(false);
  });
});

describe("ticket attachment names and paths", () => {
  it("dosya adından traversal ve kontrol karakterlerini temizler", () => {
    expect(normalizeTicketAttachmentName("../\\\u0000 kimlik.PDF", "pdf")).toBe("- kimlik.pdf");
  });

  it("storage yolunu yalnız kararlı UUID segmentleriyle kurar", () => {
    const path = buildTicketAttachmentPath(TENANT, TICKET, ATTACHMENT, "pdf");
    expect(path).toBe(`${TENANT}/${TICKET}/${ATTACHMENT}.pdf`);
    expect(isSafeTicketAttachmentPath(path, TENANT, TICKET)).toBe(true);
    expect(isSafeTicketAttachmentPath(`${TENANT}/${TICKET}/../../secret.pdf`, TENANT, TICKET)).toBe(false);
    expect(isSafeTicketAttachmentPath(path, ATTACHMENT, TICKET)).toBe(false);
  });

  it("signed upload oturumunda 10 MB ve allowlist sınırını uygular", () => {
    expect(prepareTicketAttachmentUploadDescriptor({ name: "liste.csv", type: "application/vnd.ms-excel", size: 10 }).ok).toBe(true);
    expect(prepareTicketAttachmentUploadDescriptor({ name: "script.svg", type: "image/svg+xml", size: 10 }).ok).toBe(false);
    expect(prepareTicketAttachmentUploadDescriptor({ name: "buyuk.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }).ok).toBe(false);
  });
});
