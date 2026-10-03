import { describe, expect, it } from "vitest";
import { calculateRoi, parseTrNumber, type RoiRaw } from "./roi-calculator";

const plan = { monthlyTry: 2490, seats: 5 };
const base: RoiRaw = { monthlyLeads: "100", avgPrice: "5.000.000", commissionRate: "2", conversionRate: "5", untrackedRate: "30", advisors: "4" };

describe("parseTrNumber", () => {
  it("TR biçimlerini okur", () => {
    expect(parseTrNumber("1.500.000")).toBe(1_500_000);
    expect(parseTrNumber("3,5")).toBe(3.5);
    expect(parseTrNumber("2.5")).toBe(2.5);
    expect(parseTrNumber(" 40 ")).toBe(40);
  });
  it("geçersizi null yapar", () => {
    for (const v of ["", "abc", "-5", "1e3", "NaN", "Infinity", "1,2,3"]) expect(parseTrNumber(v)).toBeNull();
  });
});

describe("calculateRoi", () => {
  it("boş girdide empty", () => {
    const empty: RoiRaw = { monthlyLeads: "", avgPrice: "", commissionRate: "", conversionRate: "", untrackedRate: "", advisors: "" };
    expect(calculateRoi(empty, plan).status).toBe("empty");
  });
  it("hesabı commission.ts üzerinden yapar", () => {
    const r = calculateRoi(base, plan);
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.untrackedLeads).toBe(30);
    expect(r.missedDeals).toBeCloseTo(1.5);
    expect(r.commissionPerDeal).toBe(100_000); // 5.000.000 × %2, KDV hariç
    expect(r.missedMonthly).toBeCloseTo(150_000);
    expect(r.missedYearly).toBeCloseTo(1_800_000);
    expect(r.coverage).toBeCloseTo(150_000 / 2490);
    expect(r.breakEvenDeals).toBeCloseTo(2490 / 100_000);
    expect(r.seatsExceeded).toBe(false);
  });
  it("danışman sayısı paket kapsamını aşarsa uyarır", () => {
    const r = calculateRoi({ ...base, advisors: "6" }, plan);
    expect(r.status === "ok" && r.seatsExceeded).toBe(true);
  });
  it("danışman sayısı boş olabilir", () => {
    expect(calculateRoi({ ...base, advisors: "" }, plan).status).toBe("ok");
  });
  it("yüzde 100 üstü ve negatif/NaN girdide invalid", () => {
    const r = calculateRoi({ ...base, untrackedRate: "130", conversionRate: "-1" }, plan);
    expect(r).toEqual({ status: "invalid", fields: ["conversionRate", "untrackedRate"] });
    expect(calculateRoi({ ...base, avgPrice: "" }, plan).status).toBe("invalid");
  });
  it("sıfır oranlar NaN üretmez", () => {
    const r = calculateRoi({ ...base, untrackedRate: "0", commissionRate: "0" }, { monthlyTry: 0, seats: 1 });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.missedMonthly).toBe(0);
    expect(r.coverage).toBeNull();
    expect(r.breakEvenDeals).toBeNull();
    expect(Number.isNaN(r.netMonthly)).toBe(false);
  });
});
