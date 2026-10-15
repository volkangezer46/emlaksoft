import { describe, expect, it } from "vitest";
import {
  VALIDITY_SOON_DAYS,
  addDaysKey,
  normalizeDateKey,
  parseValidityFilter,
  validityRange,
  validityStateOf,
} from "@/lib/documents";

describe("?gecerlilik= filtre ayrıştırma", () => {
  it("yalnız yaklasan|gecmis kabul eder (büyük harf/boşluk toleranslı)", () => {
    expect(parseValidityFilter("yaklasan")).toBe("yaklasan");
    expect(parseValidityFilter("gecmis")).toBe("gecmis");
    expect(parseValidityFilter(" GECMIS ")).toBe("gecmis");
    expect(parseValidityFilter("")).toBe("");
    expect(parseValidityFilter(undefined)).toBe("");
    expect(parseValidityFilter(null)).toBe("");
    expect(parseValidityFilter("yaklaşan")).toBe("");
    expect(parseValidityFilter("gecerli")).toBe("");
  });

  it("aralıklar: yaklasan = bugün..bugün+30, gecmis = bugünden önce", () => {
    expect(VALIDITY_SOON_DAYS).toBe(30);
    expect(validityRange("yaklasan", "2026-10-16")).toEqual({ gte: "2026-10-16", lte: "2026-11-15" });
    expect(validityRange("gecmis", "2026-10-16")).toEqual({ lt: "2026-10-16" });
  });

  it("gün aritmetiği ay/yıl sınırında kaymaz", () => {
    expect(addDaysKey("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("tarih doğrulama ve rozet durumu", () => {
  it("normalizeDateKey yalnız gerçek takvim gününü kabul eder", () => {
    expect(normalizeDateKey("2026-10-16")).toBe("2026-10-16");
    expect(normalizeDateKey(" 2026-10-16 ")).toBe("2026-10-16");
    expect(normalizeDateKey("2026-02-30")).toBeNull();
    expect(normalizeDateKey("16.10.2026")).toBeNull();
    expect(normalizeDateKey("")).toBeNull();
    expect(normalizeDateKey(null)).toBeNull();
  });

  it("validityStateOf: geçmiş / yaklaşan (0..30) / geçerli / yok", () => {
    const today = "2026-10-16";
    expect(validityStateOf("2026-10-15", today)).toEqual({ status: "gecmis", daysLeft: -1 });
    expect(validityStateOf("2026-10-16", today)).toEqual({ status: "yaklasan", daysLeft: 0 });
    expect(validityStateOf("2026-11-15", today)).toEqual({ status: "yaklasan", daysLeft: 30 });
    expect(validityStateOf("2026-11-16", today)).toEqual({ status: "gecerli", daysLeft: 31 });
    expect(validityStateOf(null, today)).toBeNull();
    expect(validityStateOf("bozuk", today)).toBeNull();
  });
});
