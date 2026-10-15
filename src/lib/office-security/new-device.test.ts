import { describe, expect, it } from "vitest";
import { categoryOf, categoryOrExpr, feedActionLabel } from "@/lib/oversight/feed";
import {
  AUTH_LOGIN_ACTION,
  NEW_DEVICE_WINDOW_DAYS,
  deviceFingerprint,
  isNewDeviceInWindow,
  loginAuditValue,
  primaryLanguage,
} from "./new-device";

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const CHROME_WIN_NEXT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const NOW = Date.parse("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("G3 cihaz parmak izi (saf)", () => {
  it("birincil dil Accept-Language'den güvenle çıkarılır", () => {
    expect(primaryLanguage("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(primaryLanguage("EN-us")).toBe("en");
    expect(primaryLanguage("*")).toBe("");
    expect(primaryLanguage(null)).toBe("");
    expect(primaryLanguage("<script>")).toBe("");
  });

  it("parmak izi kararlı, kısa, ham UA içermez; sürüm güncellemesi değiştirmez", () => {
    const a = deviceFingerprint(CHROME_WIN, "tr-TR");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceFingerprint(CHROME_WIN_NEXT, "tr-TR,tr;q=0.9")).toBe(a);
    expect(deviceFingerprint(SAFARI_IOS, "tr-TR")).not.toBe(a);
    expect(deviceFingerprint(CHROME_WIN, "en-US")).not.toBe(a);
  });

  it("denetim gövdesi ham IP/UA taşımaz", () => {
    const v = loginAuditValue({ userAgent: CHROME_WIN, acceptLanguage: "tr", ip: "203.0.113.7" });
    const text = JSON.stringify(v);
    expect(text).not.toContain("203.0.113.7");
    expect(text).not.toContain("Mozilla");
    expect(v.device).toBe("Windows · Chrome");
    expect(v.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.method).toBe("password");
    expect(loginAuditValue({ userAgent: null, acceptLanguage: null, ip: "unknown" }).ip_hash).toBeNull();
  });
});

describe("G3 yeni cihaz kararı (90 gün penceresi)", () => {
  it("hiç önceki giriş yoksa yeni sayılmaz (ilk giriş)", () => {
    expect(isNewDeviceInWindow([], CHROME_WIN, NOW)).toBe(false);
  });

  it("pencere içinde aynı cihaz etiketi görüldüyse yeni değil", () => {
    expect(isNewDeviceInWindow([{ userAgent: CHROME_WIN, createdAt: daysAgo(10) }], CHROME_WIN_NEXT, NOW)).toBe(false);
  });

  it("farklı cihaz ya da yalnız pencere dışında görülen cihaz yeni sayılır", () => {
    expect(isNewDeviceInWindow([{ userAgent: CHROME_WIN, createdAt: daysAgo(1) }], SAFARI_IOS, NOW)).toBe(true);
    expect(
      isNewDeviceInWindow([{ userAgent: CHROME_WIN, createdAt: daysAgo(NEW_DEVICE_WINDOW_DAYS + 1) }], CHROME_WIN, NOW),
    ).toBe(true);
    expect(isNewDeviceInWindow([{ userAgent: CHROME_WIN, createdAt: null }], CHROME_WIN, NOW)).toBe(true);
  });
});

describe("G3 işlem akışı kategorisi", () => {
  it("auth.login ve security.* Güvenlik / giriş kategorisinde", () => {
    expect(categoryOf(AUTH_LOGIN_ACTION)?.id).toBe("guvenlik");
    expect(categoryOf("security.session.revoke")?.label).toBe("Güvenlik / giriş");
    expect(categoryOrExpr("guvenlik")).toBe("action.like.auth.*,action.like.security.*");
    expect(feedActionLabel(AUTH_LOGIN_ACTION)).toBe("Panele giriş yapıldı");
  });
});
