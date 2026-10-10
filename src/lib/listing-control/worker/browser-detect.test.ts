import { describe, expect, it } from "vitest";
import { detectBrowser, modKey, pickInstallAction } from "./browser-detect";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  operaWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
};
const urls = { chrome: "https://chromewebstore.google.com/detail/x/abc", edge: "https://microsoftedge.microsoft.com/addons/detail/x/abc", zip: "/zip" };

describe("detectBrowser", () => {
  it("Chrome ve Chromium kardeşleri Chrome mağazasına gider", () => {
    expect(detectBrowser({ ua: UA.chromeWin, platform: "Windows" })).toMatchObject({ family: "chrome", name: "Chrome", os: "windows" });
    expect(detectBrowser({ ua: UA.operaWin }).family).toBe("chrome");
    expect(detectBrowser({ ua: UA.chromeWin, brands: ["Brave", "Chromium"] })).toMatchObject({ family: "chrome", name: "Brave" });
    expect(detectBrowser({ ua: UA.chromeMac, brands: ["Chromium", "Google Chrome"], platform: "macOS" })).toMatchObject({ family: "chrome", os: "mac" });
  });
  it("Edge ayrı mağaza; userAgentData markası UA'dan önce gelir", () => {
    expect(detectBrowser({ ua: UA.edgeWin }).family).toBe("edge");
    expect(detectBrowser({ ua: UA.chromeWin, brands: ["Microsoft Edge", "Chromium"] }).family).toBe("edge");
  });
  it("Safari, Firefox ve mobil desteklenmez", () => {
    expect(detectBrowser({ ua: UA.safariMac })).toMatchObject({ family: "unsupported", name: "Safari", os: "mac" });
    expect(detectBrowser({ ua: UA.firefoxMac })).toMatchObject({ family: "unsupported", name: "Firefox" });
    expect(detectBrowser({ ua: UA.chromeAndroid })).toMatchObject({ family: "unsupported", mobile: true });
    expect(detectBrowser({ ua: UA.chromeWin, mobile: true }).family).toBe("unsupported");
    expect(detectBrowser({ ua: UA.safariMac, touchPoints: 5 })).toMatchObject({ family: "unsupported", mobile: true }); // iPadOS masaüstü UA
  });
  it("Mac'te ⌘, diğerlerinde Ctrl", () => {
    expect(modKey("mac")).toBe("⌘");
    expect(modKey("windows")).toBe("Ctrl");
  });
});

describe("pickInstallAction", () => {
  const chrome = detectBrowser({ ua: UA.chromeWin });
  const edge = detectBrowser({ ua: UA.edgeWin });
  it("mağaza adresi varsa tek birincil mağaza düğmesi", () => {
    expect(pickInstallAction(chrome, urls)).toMatchObject({ kind: "store", store: "chrome", label: "Chrome'a ekle" });
    expect(pickInstallAction(edge, urls)).toMatchObject({ kind: "store", store: "edge", label: "Edge'e ekle", href: urls.edge });
  });
  it("Edge yalnız Chrome adresi varsa onu kullanır", () => {
    expect(pickInstallAction(edge, { ...urls, edge: null })).toMatchObject({ kind: "store", href: urls.chrome });
  });
  it("adres yoksa ZIP, o da yoksa none; desteklenmeyende unsupported", () => {
    expect(pickInstallAction(chrome, { chrome: null, edge: null, zip: "/zip" })).toEqual({ kind: "zip", href: "/zip" });
    expect(pickInstallAction(chrome, { chrome: null, edge: null, zip: null })).toEqual({ kind: "none" });
    expect(pickInstallAction(detectBrowser({ ua: UA.safariMac }), urls)).toEqual({ kind: "unsupported" });
  });
});
