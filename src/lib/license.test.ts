import { describe, expect, it } from "vitest";
import {
  annualLicenseFeeReminderDue,
  daysBetweenDayKeys,
  LICENSE_AMENDMENT_DAYS,
  licenseAmendmentChanges,
  licenseAmendmentMessage,
  licenseExpiryReminderStep,
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

describe("yetki belgesi tadil + yıllık harç + bitiş kademesi", () => {
  const base = { name: "Örnek Emlak", addressLine: "Atatürk Cd. 1", licenseTitle: "Örnek Gayrimenkul", provinceId: "p1", districtId: "d1" };
  it("ünvan/adres değişikliği yakalanır; boşluk/harf farkı ve temizleme değişiklik değildir", () => {
    expect(licenseAmendmentChanges(base, { ...base, name: "  örnek   emlak " })).toEqual([]);
    expect(licenseAmendmentChanges(base, { ...base, licenseTitle: "" })).toEqual([]);
    expect(licenseAmendmentChanges(base, { ...base, name: "Yeni Emlak" })).toEqual(["işletme adı"]);
    expect(licenseAmendmentChanges(base, { ...base, districtId: "d2" })).toEqual(["adres (il/ilçe)"]);
    expect(licenseAmendmentChanges(base, { ...base, addressLine: "Cumhuriyet Cd. 5", districtId: "d2" })).toEqual(["adres"]);
  });
  it("tadil metni süreyi tek sabitten verir ve doğrulama notu taşır", () => {
    const m = licenseAmendmentMessage(["adres"]);
    expect(m.body).toContain(`${LICENSE_AMENDMENT_DAYS} gün`);
    expect(m.body).toMatch(/doğrulayın/);
  });
  it("yıllık harç hatırlatması yalnız seçilen ayda; 0 = kapalı", () => {
    expect(annualLicenseFeeReminderDue(1, "2027-01-03")).toBe(true);
    expect(annualLicenseFeeReminderDue(1, "2027-02-03")).toBe(false);
    expect(annualLicenseFeeReminderDue(0, "2027-01-03")).toBe(false);
  });
  it("bitiş kademesi 60/30/7 ve en çok 30 gün geçmiş", () => {
    expect(licenseExpiryReminderStep("2027-03-01", "2027-01-15")).toBe("60");
    expect(licenseExpiryReminderStep("2027-03-01", "2027-02-20")).toBe("30");
    expect(licenseExpiryReminderStep("2027-03-01", "2027-02-25")).toBe("7");
    expect(licenseExpiryReminderStep("2027-03-01", "2026-10-01")).toBeNull();
    expect(licenseExpiryReminderStep("2027-03-01", "2027-03-10")).toBe("expired");
    expect(licenseExpiryReminderStep("2027-03-01", "2027-05-10")).toBeNull();
    expect(licenseExpiryReminderStep(null, "2027-03-10")).toBeNull();
  });
});
