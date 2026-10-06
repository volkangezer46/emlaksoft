import { describe, expect, it } from "vitest";
import { formatServerTiming, sanitizeTimingName, serverTimingEnabled } from "./server-timing-core";

describe("server-timing-core", () => {
  it("W3C Server-Timing biçimi: ad;dur=ms (1 ondalık)", () => {
    expect(formatServerTiming("app-shell", 84.23)).toBe("app-shell;dur=84.2");
    expect(formatServerTiming("home-ctx", 0)).toBe("home-ctx;dur=0.0");
  });
  it("ad yalnız [a-z0-9-]; boşluk/yol/e-posta gibi değerler temizlenir (PII yok)", () => {
    expect(sanitizeTimingName("App Shell / RPC")).toBe("app-shell-rpc");
    expect(sanitizeTimingName("ali@ornek.com")).toBe("ali-ornek-com");
    expect(sanitizeTimingName("!!!")).toBe("olcum");
    expect(sanitizeTimingName("x".repeat(80))).toHaveLength(40);
  });
  it("geçersiz süre 0 olur", () => {
    expect(formatServerTiming("a", Number.NaN)).toBe("a;dur=0.0");
    expect(formatServerTiming("a", -5)).toBe("a;dur=0.0");
  });
  it("yalnız EMLAKSOFT_SERVER_TIMING=1 iken açık", () => {
    expect(serverTimingEnabled({ EMLAKSOFT_SERVER_TIMING: "1" })).toBe(true);
    expect(serverTimingEnabled({ EMLAKSOFT_SERVER_TIMING: "true" })).toBe(false);
    expect(serverTimingEnabled({})).toBe(false);
  });
});
