import { describe, expect, it } from "vitest";
import {
  daysBetweenDayKeys,
  licenseStatus,
  listingPublishLicenseWarning,
  normalizeLicenseNo,
  normalizeLicenseTitle,
  normalizeLicenseValidUntil,
} from "./license";

describe("normalizeLicenseNo", () => {
  it("esnek biçim: boşluk ve harf kabul, kenar boşluğu atılır", () => {
    expect(normalizeLicenseNo("  TR-46  00123 ")).toEqual({ ok: true, value: "TR-46 00123" });
    expect(normalizeLicenseNo("abc/12.3_4")).toEqual({ ok: true, value: "abc/12.3_4" });
  });
  it("boş girdi null", () => {
    expect(normalizeLicenseNo("   ")).toEqual({ ok: true, value: null });
    expect(normalizeLicenseNo(null)).toEqual({ ok: true, value: null });
  });
  it("anlamsız, uzun veya yasaklı karakterli girdi reddedilir", () => {
    expect(normalizeLicenseNo("---").ok).toBe(false);
    expect(normalizeLicenseNo("<script>").ok).toBe(false);
    expect(normalizeLicenseNo("1".repeat(61)).ok).toBe(false);
  });
});

describe("normalizeLicenseTitle / ValidUntil", () => {
  it("unvan sınırı", () => {
    expect(normalizeLicenseTitle("  Örnek   Gayrimenkul ")).toEqual({ ok: true, value: "Örnek Gayrimenkul" });
    expect(normalizeLicenseTitle("x".repeat(201)).ok).toBe(false);
  });
  it("tarih gerçek takvim günü olmalı", () => {
    expect(normalizeLicenseValidUntil("2027-02-28")).toEqual({ ok: true, value: "2027-02-28" });
    expect(normalizeLicenseValidUntil("2027-02-30").ok).toBe(false);
    expect(normalizeLicenseValidUntil("28.02.2027").ok).toBe(false);
    expect(normalizeLicenseValidUntil("")).toEqual({ ok: true, value: null });
  });
});

describe("licenseStatus 60/30/7", () => {
  const today = "2026-10-06";
  const mk = (validUntil: string | null, licenseNo: string | null = "TR-1") => licenseStatus({ licenseNo, validUntil }, today);

  it("no yoksa missing (danger)", () => {
    expect(mk(null, null)).toMatchObject({ state: "missing", tone: "danger" });
    expect(mk("2027-01-01", "  ")).toMatchObject({ state: "missing" });
  });
  it("tarih yoksa no_date", () => {
    expect(mk(null)).toMatchObject({ state: "no_date", daysLeft: null });
  });
  it("eşikler: 61 gün geçerli; 60 -> 60; 30 -> 30; 7 -> 7; 0 bugün; -1 doldu", () => {
    expect(daysBetweenDayKeys("2026-10-06", "2026-12-05")).toBe(60);
    expect(mk("2026-12-06")).toMatchObject({ state: "valid", threshold: null });
    expect(mk("2026-12-05")).toMatchObject({ state: "expiring", threshold: 60, tone: "warning" });
    expect(mk("2026-11-05")).toMatchObject({ state: "expiring", threshold: 30, tone: "danger" });
    expect(mk("2026-10-13")).toMatchObject({ state: "expiring", threshold: 7, daysLeft: 7 });
    expect(mk("2026-10-06")).toMatchObject({ state: "expiring", threshold: 7, daysLeft: 0 });
    expect(mk("2026-10-05")).toMatchObject({ state: "expired", daysLeft: -1, tone: "danger" });
  });
});

describe("listingPublishLicenseWarning", () => {
  it("eksik veya süresi dolmuşsa uyarır; geçerli/yaklaşan için uyarmaz (yayın engellenmez)", () => {
    expect(listingPublishLicenseWarning(licenseStatus({ licenseNo: null, validUntil: null }, "2026-10-06"))).toMatch(/yetki belgesi/i);
    expect(listingPublishLicenseWarning(licenseStatus({ licenseNo: "A1", validUntil: "2026-01-01" }, "2026-10-06"))).toMatch(/doldu/);
    expect(listingPublishLicenseWarning(licenseStatus({ licenseNo: "A1", validUntil: "2026-10-20" }, "2026-10-06"))).toBeNull();
    expect(listingPublishLicenseWarning(licenseStatus({ licenseNo: "A1", validUntil: null }, "2026-10-06"))).toBeNull();
  });
});
