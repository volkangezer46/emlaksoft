import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveTransferMode, sanitizeTransferWatermark, transferWatermarkFromTenant } from "./photo-watermark";
import { parsePortalFeatureFields } from "./features";
import { buildPortalPayload, type PortalPropertyInput } from "./payload";

const on = { enabled: true, mode: "both", position: "sag-alt", opacity: 60, scale: 20, text: "", marginPct: 3 };

describe("portal aktarım filigranı", () => {
  it("ayar kapalı veya yoksa filigran yok (fotoğraf orijinal gider)", () => {
    expect(transferWatermarkFromTenant(null)).toBeNull();
    expect(transferWatermarkFromTenant({ name: "Ofis", logo_url: null, watermark_settings: null })).toBeNull();
    expect(transferWatermarkFromTenant({ name: "Ofis", watermark_settings: { ...on, enabled: false } })).toBeNull();
  });
  it("açıkken ofis adı metin olur; yalnız https logo kabul edilir", () => {
    const wm = transferWatermarkFromTenant({ name: " Moda Emlak ", logo_url: "https://cdn.example/logo.png", watermark_settings: on });
    expect(wm).toMatchObject({ text: "Moda Emlak", logoUrl: "https://cdn.example/logo.png" });
    expect(transferWatermarkFromTenant({ name: "A", logo_url: "http://x/l.png", watermark_settings: on })!.logoUrl).toBeNull();
    expect(transferWatermarkFromTenant({ name: "A", watermark_settings: { ...on, text: "Özel" } })!.text).toBe("Özel");
    expect(transferWatermarkFromTenant({ name: "", logo_url: null, watermark_settings: on })).toBeNull();
  });
  it("eklenti tarafı güvenmeden doğrular", () => {
    expect(sanitizeTransferWatermark(null)).toBeNull();
    expect(sanitizeTransferWatermark({ settings: { enabled: false }, text: "x" })).toBeNull();
    expect(sanitizeTransferWatermark({ settings: { ...on, opacity: 900 }, logoUrl: "javascript:1", text: "Ofis" })).toMatchObject({ logoUrl: null, text: "Ofis", settings: { opacity: 100 } });
  });
  it("mod seçimi logo/metin yoksa düşer", () => {
    expect(effectiveTransferMode("both", true, true)).toBe("both");
    expect(effectiveTransferMode("both", false, true)).toBe("text");
    expect(effectiveTransferMode("logo", false, true)).toBe("text");
    expect(effectiveTransferMode("text", true, false)).toBe("logo");
    expect(effectiveTransferMode("logo", false, false)).toBeNull();
  });
  it("kiracı kapsamı: uç ayarı yalnız oturumun kiracısından okur ve eklenti basar", () => {
    const route = readFileSync("src/app/api/app/portal-aktar/al/route.ts", "utf8");
    expect(route).toContain('.eq("id", gate.tenantId)');
    expect(route).toContain("transferWatermarkFromTenant");
    const content = readFileSync("extensions/emlaksoft-ilan-kontrol/src/content.ts", "utf8");
    expect(content).toContain("stampTransferMark");
    expect(content).toContain("sanitizeTransferWatermark");
  });
});

describe("takasa uygun (features.swap_ok)", () => {
  it("form alanı features'a yazılır, boşsa temizlenir", () => {
    const f = (v: string) => ({ has: (n: string) => n === "swap_ok", get: () => v });
    expect(parsePortalFeatureFields(f("yes"))).toEqual({ swap_ok: true });
    expect(parsePortalFeatureFields(f("no"))).toEqual({ swap_ok: false });
    expect(parsePortalFeatureFields(f(""))).toEqual({ swap_ok: null });
  });
  it("Takas alanına bağlanır; girilmemişse alan yok", () => {
    const base = { id: "p", propertyCode: "ES-1", title: "T", transactionType: "satilik", propertyType: "Daire", listPrice: 1, provinceName: null, districtName: null, neighborhoodName: null, addressLine: null, features: {}, parcelBlock: null, parcelLot: null, eidsPropertyNo: null, authorityDocNo: null, authorityEidsStatus: null, authorizationStart: null, authorizationEnd: null, deedStatus: null, photos: [] } as const;
    expect(buildPortalPayload({ ...base, swapOk: true } as PortalPropertyInput, "sahibinden", 0).fields.swap).toBe(true);
    expect(buildPortalPayload({ ...base, swapOk: null } as PortalPropertyInput, "sahibinden", 0).fields.swap).toBeUndefined();
    const server = readFileSync("src/lib/portal-transfer/server.ts", "utf8");
    expect(server).toContain("swap_ok");
  });
});
