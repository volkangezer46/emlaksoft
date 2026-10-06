import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CREDIT_MAX_TRY,
  parseAdminGrantInput,
  parseAdminReverseInput,
  parseTryAmount,
} from "./admin-credit-input";
import { TRY_IDEM_PATTERN } from "./config";

const T = "11111111-1111-4111-8111-111111111111";
const R = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-06T10:00:00Z");
const fd = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const base = { tenant_id: T, request_id: R, amount: "1.250,50", reason: "Kampanya telafisi (destek talebi)" };

describe("parseTryAmount", () => {
  it("Türkçe ve noktalı biçimleri kuruşa yuvarlar", () => {
    expect(parseTryAmount("1.250,50")).toBe(1250.5);
    expect(parseTryAmount("1250.5")).toBe(1250.5);
    expect(parseTryAmount("750 TL")).toBe(750);
    expect(parseTryAmount("₺99,99")).toBe(99.99);
  });
  it("geçersiz biçimler NaN", () => {
    for (const bad of ["", "abc", "1,2,3", "10.123", "-5", "1e3"]) expect(parseTryAmount(bad)).toBeNaN();
  });
});

describe("parseAdminGrantInput", () => {
  it("geçerli girdi: idem anahtarı istek kimliğinden, SQL desenine uygun", () => {
    const r = parseAdminGrantInput(fd(base), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ tenantId: T, amountTry: 1250.5, kind: "manual", expiresAt: null, idem: `admin-grant:${R}` });
    expect(TRY_IDEM_PATTERN.test(r.value.idem)).toBe(true);
  });
  it("tutar sıfır/negatif/üst sınır üstü reddedilir", () => {
    expect(parseAdminGrantInput(fd({ ...base, amount: "0" }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, amount: String(ADMIN_CREDIT_MAX_TRY + 1) }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, amount: String(ADMIN_CREDIT_MAX_TRY) }), NOW).ok).toBe(true);
  });
  it("neden zorunlu (10-500), ofis ve istek kimliği uuid", () => {
    expect(parseAdminGrantInput(fd({ ...base, reason: "kısa" }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, tenant_id: "x" }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, request_id: "" }), NOW).ok).toBe(false);
  });
  it("tür yalnız manual/bonus/campaign; referans/ortak/iade elle seçilemez", () => {
    expect(parseAdminGrantInput(fd({ ...base, kind: "bonus" }), NOW).ok).toBe(true);
    expect(parseAdminGrantInput(fd({ ...base, kind: "referral" }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, kind: "refund" }), NOW).ok).toBe(false);
  });
  it("son kullanma tarihi gelecekte olmalı (gün sonu, Türkiye saati)", () => {
    const ok = parseAdminGrantInput(fd({ ...base, expires_on: "2026-12-31" }), NOW);
    expect(ok.ok && ok.value.expiresAt).toBe("2026-12-31T23:59:59+03:00");
    expect(parseAdminGrantInput(fd({ ...base, expires_on: "2026-10-01" }), NOW).ok).toBe(false);
    expect(parseAdminGrantInput(fd({ ...base, expires_on: "31.12.2026" }), NOW).ok).toBe(false);
  });
});

describe("parseAdminReverseInput", () => {
  it("geçerli girdi ve isteğe bağlı orijinal yükleme anahtarı", () => {
    const r = parseAdminReverseInput(fd({ ...base, original_idem: `admin-grant:${R}` }));
    expect(r.ok && r.value).toMatchObject({ idem: `admin-reverse:${R}`, originalIdem: `admin-grant:${R}` });
    expect(parseAdminReverseInput(fd({ ...base, original_idem: "bad key!" })).ok).toBe(false);
  });
});

describe("admin-account-credit action sözleşmesi", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/actions/admin-account-credit.ts"), "utf8");
  it("platform billing modülü + yalnız süper admin + hız sınırı", () => {
    expect(src.startsWith('"use server";')).toBe(true);
    expect(src).toContain('requirePlatformModule("billing")');
    expect(src).toContain('staff.role !== "super_admin"');
    expect(src).toContain("checkRateLimit(");
  });
  it("denetim kaydı kredi işleminden ÖNCE yazılır ve yazılamazsa işlem yapılmaz (fail-closed)", () => {
    for (const [audit, op] of [
      ['action: "tenant.try_credit_grant"', "await tryGrant("],
      ['action: "tenant.try_credit_reverse"', "await tryReverse("],
    ] as const) {
      expect(src.indexOf(audit)).toBeGreaterThan(0);
      expect(src.indexOf(audit)).toBeLessThan(src.indexOf(op));
    }
    expect(src.match(/if \(auditError\) \{/g)?.length).toBe(2);
  });
});
