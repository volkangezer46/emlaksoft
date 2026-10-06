import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SOCIAL_CARD_FORMATS,
  complianceLines,
  displayUrl,
  ensureSocialCompliance,
  isSafeListingUrl,
  pickListingLink,
} from "./core";

const listings = [
  { id: "a", portalName: "sahibinden", status: "removed", portalUrl: "https://www.sahibinden.com/ilan/1" },
  { id: "b", portalName: "hepsiemlak", status: "live", portalUrl: "http://www.hepsiemlak.com/x" },
  { id: "c", portalName: "emlakjet", status: "live", portalUrl: "https://www.emlakjet.com/ilan/9" },
  { id: "d", portalName: "sahibinden", status: "live", portalUrl: "https://www.sahibinden.com/ilan/2" },
];

describe("sosyal kart: EİDS bağlantısı zorunlu", () => {
  it("yalnız yayındaki + https bağlantı uygun; yoksa null (kart üretilmez)", () => {
    expect(pickListingLink(listings)?.id).toBe("c");
    expect(pickListingLink(listings, "d")?.id).toBe("d");
    expect(pickListingLink(listings, "a")?.id).toBe("c");
    expect(pickListingLink([listings[0], listings[1]])).toBeNull();
    expect(pickListingLink([])).toBeNull();
  });

  it("güvensiz bağlantılar reddedilir", () => {
    expect(isSafeListingUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeListingUrl("https://user:pw@evil.com/x")).toBe(false);
    expect(isSafeListingUrl("https://localhost/x")).toBe(false);
    expect(isSafeListingUrl("https://www.sahibinden.com/ilan/1")).toBe(true);
  });

  it("belge numaraları yalnız doluysa yazılır; bağlantı her zaman", () => {
    const base = { listingUrl: "https://www.emlakjet.com/ilan/9", eidsNo: null, licenseNo: null, officeName: "Örnek Emlak" };
    expect(complianceLines(base)).toEqual(["Örnek Emlak", "Doğrulanmış ilan: https://www.emlakjet.com/ilan/9"]);
    const full = complianceLines({ ...base, eidsNo: "TK-123456", licenseNo: "3400123" });
    expect(full).toContain("EİDS Taşınmaz No: TK-123456");
    expect(full).toContain("Yetki Belgesi No: 3400123");
  });

  it("metin uyum eki idempotent ve bağlantıyı tekrarlamaz", () => {
    const c = { listingUrl: "https://www.emlakjet.com/ilan/9", eidsNo: "TK-123456", licenseNo: null, officeName: null };
    const once = ensureSocialCompliance("Harika daire! #emlak", c);
    expect(once).toContain("https://www.emlakjet.com/ilan/9");
    expect(once).toContain("EİDS Taşınmaz No: TK-123456");
    expect(ensureSocialCompliance(once, c)).toBe(once);
    const withLink = ensureSocialCompliance("Detay: https://www.emlakjet.com/ilan/9", c);
    expect(withLink.match(/emlakjet\.com\/ilan\/9/g)?.length).toBe(1);
  });

  it("biçimler 1080×1080 ve 1080×1920; görünür bağlantı kısaltılır", () => {
    expect(SOCIAL_CARD_FORMATS.kare).toMatchObject({ width: 1080, height: 1080 });
    expect(SOCIAL_CARD_FORMATS.hikaye).toMatchObject({ width: 1080, height: 1920 });
    expect(displayUrl("https://www.sahibinden.com/ilan/emlak-konut-satilik-cok-uzun-bir-baslik-1234567890/detay")).toMatch(/…$/);
  });

  it("kart rotası bağlantı yoksa görsel üretmez ve sosyal AI metni bağlantıyı zorunlu tutar", () => {
    const route = readFileSync("src/app/api/app/portfoy/[id]/sosyal-kart/route.tsx", "utf8");
    expect(route).toContain("pickListingLink");
    expect(route).toContain("SOCIAL_LINK_REQUIRED_MESSAGE");
    expect(route).toContain('requirePermission("properties", "view")');
    const action = readFileSync("src/app/actions/ai-content.ts", "utf8");
    expect(action).toContain("ensureSocialCompliance");
    expect(action).toContain("SOCIAL_LINK_REQUIRED_MESSAGE");
  });
});
