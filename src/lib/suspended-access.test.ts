import { describe, expect, it } from "vitest";
import { isSuspendedAllowedPath } from "@/lib/suspended-access";
import { isSuspendedPaymentAllowed } from "@/lib/tenant-guard";

describe("askıdaki ofis erişimi (P0-12)", () => {
  it("askıda: /app/askida ve /app/abonelik açık", () => {
    expect(isSuspendedAllowedPath("/app/askida", "suspended")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik", "suspended")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik/fatura/1", "suspended")).toBe(true);
  });

  it("askıda: diğer tüm /app yolları kapalı", () => {
    for (const p of ["/app", "/app/musteriler", "/app/ayarlar", "/app/abonelikler", "/app/ekip"]) {
      expect(isSuspendedAllowedPath(p, "suspended")).toBe(false);
    }
  });

  it("iptal: yalnız /app/askida açık, ödeme yolu kapalı", () => {
    expect(isSuspendedAllowedPath("/app/askida", "cancelled")).toBe(true);
    expect(isSuspendedAllowedPath("/app/abonelik", "cancelled")).toBe(false);
    expect(isSuspendedAllowedPath("/app/abonelik", null)).toBe(false);
  });

  it("ödeme action kapısı yalnız askıdaki ofise açılır", () => {
    expect(isSuspendedPaymentAllowed("suspended")).toBe(true);
    expect(isSuspendedPaymentAllowed("cancelled")).toBe(false);
    expect(isSuspendedPaymentAllowed("active")).toBe(false);
  });
});
