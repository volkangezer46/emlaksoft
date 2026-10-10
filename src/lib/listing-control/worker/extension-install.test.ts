import { describe, expect, it } from "vitest";
import { installLandingUrl, isBindLanding, shouldOpenInstallLanding } from "./extension-install";
import { isTrustedScanRequest } from "./extension-pairing";

describe("kurulum karşılaması", () => {
  it("yalnız ilk kurulumda açılır", () => {
    expect(shouldOpenInstallLanding("install")).toBe(true);
    for (const r of ["update", "chrome_update", "shared_module_update", "", null, undefined]) expect(shouldOpenInstallLanding(r)).toBe(false);
  });
  it("adres yalnız izinli EmlakSoft kökeninden kurulur (sonuncu = birincil)", () => {
    expect(installLandingUrl(["https://ofis.example.com", "https://emlaksoft.vercel.app"])).toBe("https://emlaksoft.vercel.app/app/ilan-kontrol?bagla=1");
    expect(installLandingUrl(["https://emlaksoft.vercel.app/"])).toBe("https://emlaksoft.vercel.app/app/ilan-kontrol?bagla=1");
  });
  it("izinsiz/boş/http kökeninde hiçbir şey açılmaz", () => {
    expect(installLandingUrl([])).toBeNull();
    expect(installLandingUrl(["http://emlaksoft.example.com"])).toBeNull();
    expect(installLandingUrl(["not a url"])).toBeNull();
  });
  it("sayfa yalnız bagla=1 değerini tanır", () => {
    expect(isBindLanding("1")).toBe(true);
    expect(isBindLanding("true")).toBe(false);
    expect(isBindLanding(null)).toBe(false);
  });
});

describe("şimdi-tara isteği güveni", () => {
  const base = { fromSameWindow: true, eventOrigin: "https://emlaksoft.vercel.app", locationOrigin: "https://emlaksoft.vercel.app", allowedOrigins: ["https://emlaksoft.vercel.app"], data: { type: "scan-request", nonce: "abcdef0123456789" } };
  it("aynı pencere + izinli köken + biçim tamamsa kabul", () => {
    expect(isTrustedScanRequest(base)).toBe(true);
  });
  it("başka köken, başka pencere, kötü biçim reddedilir", () => {
    expect(isTrustedScanRequest({ ...base, fromSameWindow: false })).toBe(false);
    expect(isTrustedScanRequest({ ...base, eventOrigin: "https://evil.example" })).toBe(false);
    expect(isTrustedScanRequest({ ...base, locationOrigin: "https://evil.example", eventOrigin: "https://evil.example" })).toBe(false);
    expect(isTrustedScanRequest({ ...base, data: { type: "connect-request", nonce: "abcdef0123456789" } })).toBe(false);
    expect(isTrustedScanRequest({ ...base, data: { type: "scan-request", nonce: "x" } })).toBe(false);
  });
});
