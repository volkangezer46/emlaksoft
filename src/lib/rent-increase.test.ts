import { describe, expect, it } from "vitest";
import {
  computeRentIncrease,
  daysUntilIncrease,
  nextIncreaseDate,
  renewalMonth,
} from "./rent-increase";

describe("computeRentIncrease", () => {
  it("tavan = kira * (1 + TÜFE)", () => {
    const r = computeRentIncrease({ currentRent: 10_000, cpiAverage12m: 45.5 });
    expect(r.valid).toBe(true);
    expect(r.maxNewRent).toBe(14_550);
    expect(r.maxIncreaseAmount).toBe(4_550);
    expect(r.maxRatePct).toBe(45.5);
    expect(r.agreedNewRent).toBeNull();
    expect(r.effectiveNewRent).toBe(14_550);
  });
  it("sıfır TÜFE kirayı değiştirmez", () => {
    expect(computeRentIncrease({ currentRent: 5000, cpiAverage12m: 0 }).maxNewRent).toBe(5000);
  });
  it("anlaşılan oran tavan içinde", () => {
    const r = computeRentIncrease({ currentRent: 10_000, cpiAverage12m: 40, agreedRatePct: 20 });
    expect(r.agreedExceeds).toBe(false);
    expect(r.effectiveNewRent).toBe(12_000);
  });
  it("anlaşılan oran tavanı aşınca kırpılır", () => {
    const r = computeRentIncrease({ currentRent: 10_000, cpiAverage12m: 40, agreedRatePct: 60 });
    expect(r.agreedExceeds).toBe(true);
    expect(r.agreedNewRent).toBe(16_000);
    expect(r.effectiveNewRent).toBe(14_000);
  });
  it("kuruşa yuvarlar", () => {
    const r = computeRentIncrease({ currentRent: 3333.33, cpiAverage12m: 33.333 });
    expect(r.maxNewRent).toBe(Math.round(r.maxNewRent * 100) / 100);
  });
  it("geçersiz girdiler", () => {
    expect(computeRentIncrease({ currentRent: 0, cpiAverage12m: 10 }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: -1, cpiAverage12m: 10 }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: NaN, cpiAverage12m: 10 }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: 100, cpiAverage12m: NaN }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: 100, cpiAverage12m: -2 }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: 100, cpiAverage12m: 5, agreedRatePct: -1 }).valid).toBe(false);
    expect(computeRentIncrease({ currentRent: 100, cpiAverage12m: 5, agreedRatePct: NaN }).valid).toBe(false);
  });
});

describe("nextIncreaseDate", () => {
  it("başlangıç gelecekteyse başlangıç + 12 ay", () => {
    expect(nextIncreaseDate("2026-12-01", "2026-10-02")).toBe("2027-12-01");
  });
  it("bir yıl dolmamışsa ilk yıldönümü", () => {
    expect(nextIncreaseDate("2026-03-15", "2026-10-02")).toBe("2027-03-15");
  });
  it("yıldönümü bugünse bugün", () => {
    expect(nextIncreaseDate("2024-10-02", "2026-10-02")).toBe("2026-10-02");
  });
  it("yıldönümü geçmişse sonraki yıl", () => {
    expect(nextIncreaseDate("2022-01-10", "2026-10-02")).toBe("2027-01-10");
  });
  it("29 Şubat başlangıcı ay sonuna çekilir", () => {
    expect(nextIncreaseDate("2024-02-29", "2024-03-01")).toBe("2025-02-28");
    expect(nextIncreaseDate("2024-02-29", "2027-03-01")).toBe("2028-02-29");
  });
  it("geçersiz tarih null", () => {
    expect(nextIncreaseDate("abc", "2026-10-02")).toBeNull();
    expect(nextIncreaseDate("2026-13-01", "2026-10-02")).toBeNull();
    expect(nextIncreaseDate("2026-02-30", "2026-10-02")).toBeNull();
    expect(nextIncreaseDate("2026-01-01", "")).toBeNull();
  });
});

describe("daysUntilIncrease", () => {
  it("bugünse 0", () => expect(daysUntilIncrease("2024-10-02", "2026-10-02")).toBe(0));
  it("gün sayar", () => expect(daysUntilIncrease("2024-10-12", "2026-10-02")).toBe(10));
  it("geçersizde null", () => expect(daysUntilIncrease("x", "2026-10-02")).toBeNull());
});

describe("renewalMonth", () => {
  it("yenileme ayı", () => expect(renewalMonth("2025-09-01")).toEqual({ month: 9, name: "Eylül" }));
  it("geçersizde null", () => expect(renewalMonth("")).toBeNull());
});
