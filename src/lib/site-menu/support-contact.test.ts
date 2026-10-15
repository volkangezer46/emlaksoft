import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact-info";
import { defaultSiteMenu } from "./defaults";
import { applySupportEmail } from "./support-contact";

describe("applySupportEmail: menü ve alt bilgide destek adresi ayardan", () => {
  it("varsayılan menüdeki Destek öğesi ve İletişim sütunu yeni adresi ve mailto'yu alır", () => {
    const cfg = defaultSiteMenu();
    const out = applySupportEmail(cfg, "yardim@ornek.com.tr");
    const json = JSON.stringify(out);
    expect(json).not.toContain(SUPPORT_EMAIL);
    expect(json).toContain("mailto:yardim@ornek.com.tr");
    expect(JSON.stringify(cfg)).toContain(SUPPORT_MAILTO); // girdi değişmez
  });
  it("adres aynı ya da boşsa nesne aynen döner", () => {
    const cfg = defaultSiteMenu();
    expect(applySupportEmail(cfg, SUPPORT_EMAIL)).toBe(cfg);
    expect(applySupportEmail(cfg, "  ")).toBe(cfg);
  });
});
