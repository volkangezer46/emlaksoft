import { describe, expect, it } from "vitest";
import { inboundMediaPath, isAllowedMetaMediaUrl, normalizeInboundMime, safeMediaBaseName } from "./whatsapp-media-rules";
import { parseMetaMediaFields } from "@/lib/webhooks/meta-contract";

describe("COM-03 WhatsApp gelen medya kuralları", () => {
  it("MIME izin listesi ve codecs ekinin atılması", () => {
    expect(normalizeInboundMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeInboundMime("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeInboundMime("application/x-msdownload")).toBeNull();
    expect(normalizeInboundMime(null)).toBeNull();
  });

  it("yalnız Meta medya alan adı (SSRF kapısı)", () => {
    expect(isAllowedMetaMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")).toBe(true);
    expect(isAllowedMetaMediaUrl("http://lookaside.fbsbx.com/x")).toBe(false);
    expect(isAllowedMetaMediaUrl("https://evil.example.com/fbsbx.com")).toBe(false);
    expect(isAllowedMetaMediaUrl("https://fbsbx.com.evil.io/x")).toBe(false);
    expect(isAllowedMetaMediaUrl("https://user:pw@lookaside.fbsbx.com/x")).toBe(false);
    expect(isAllowedMetaMediaUrl("yok")).toBe(false);
  });

  it("yol kiracı önekli, ay klasörlü, güvenli ad", () => {
    const path = inboundMediaPath({
      tenantId: "t1",
      communicationId: "c1",
      mime: "application/pdf",
      filename: "../Tapu Fotokopisi ŞÇ.pdf",
      at: new Date(Date.UTC(2026, 9, 15)),
    });
    expect(path).toBe("t1/2026/10/c1/tapu-fotokopisi-sc.pdf");
    expect(safeMediaBaseName("")).toBe("dosya");
  });

  it("webhook ayrıştırıcısı medya ve konumu sınırlı çıkarır; bozuk alan olayı düşürmez", () => {
    expect(parseMetaMediaFields({ image: { id: "123", mime_type: "image/jpeg", caption: "Salon" } }, "image")).toEqual({
      media: { id: "123", mimeType: "image/jpeg", caption: "Salon", filename: null },
    });
    expect(parseMetaMediaFields({ image: { id: "abc" } }, "image")).toEqual({});
    expect(parseMetaMediaFields({ location: { latitude: 41.0, longitude: 29.0, name: "Ev" } }, "location")).toEqual({
      location: { latitude: 41, longitude: 29, name: "Ev", address: null },
    });
    expect(parseMetaMediaFields({ location: { latitude: 200, longitude: 0 } }, "location")).toEqual({});
  });
});
