import { describe, it, expect } from "vitest";
import { computePurchaseCosts, DEFAULT_RATES } from "./purchase-costs";

describe("yeni bina KDV", () => {
  it("ikinci elde (newBuild yok) KDV satırı çıkmaz", () => {
    const r = computePurchaseCosts({ price: 5_000_000, sqm: 120 });
    expect(r.lines.some((l) => l.key === "new_build_vat")).toBe(false);
  });

  it("≤150 m² yeni konutta %1 KDV", () => {
    const r = computePurchaseCosts({ price: 5_000_000, sqm: 120, newBuild: true });
    const vat = r.lines.find((l) => l.key === "new_build_vat");
    expect(vat).toBeTruthy();
    expect(vat!.amount).toBe(50_000); // 5.000.000 × %1
  });

  it(">150 m² yeni konutta %20 KDV", () => {
    const r = computePurchaseCosts({ price: 10_000_000, sqm: 200, newBuild: true });
    const vat = r.lines.find((l) => l.key === "new_build_vat");
    expect(vat!.amount).toBe(2_000_000); // 10.000.000 × %20
  });

  it("işyeri yeni binada %20 KDV (m²'den bağımsız)", () => {
    const r = computePurchaseCosts({ price: 8_000_000, sqm: 80, newBuild: true, propertyKind: "commercial" });
    const vat = r.lines.find((l) => l.key === "new_build_vat");
    expect(vat!.amount).toBe(1_600_000); // 8.000.000 × %20
  });

  it("yeni bina KDV toplam maliyete ve cepten çıkana yansır", () => {
    const ikinciEl = computePurchaseCosts({ price: 5_000_000, sqm: 120 });
    const yeni = computePurchaseCosts({ price: 5_000_000, sqm: 120, newBuild: true });
    expect(yeni.totalCosts).toBe(ikinciEl.totalCosts + 50_000);
  });
});

describe("işyeri kira stopajı", () => {
  it("işyeri kirasında stopaj bilgi notu üretilir (toplama eklenmez)", () => {
    const r = computePurchaseCosts({ price: 40_000, transactionType: "rent", propertyKind: "commercial" });
    expect(r.notes.some((n) => /stopaj/i.test(n))).toBe(true);
    // stopaj bir "cost line" değil — toplam yalnız komisyondan oluşur
    expect(r.lines.some((l) => /stopaj/i.test(l.label))).toBe(false);
  });

  it("konut kirasında stopaj notu YOK", () => {
    const r = computePurchaseCosts({ price: 40_000, transactionType: "rent", propertyKind: "residential" });
    expect(r.notes.some((n) => /stopaj/i.test(n))).toBe(false);
  });
});

describe("geriye uyum", () => {
  it("mevcut ikinci-el satış hesabı değişmez (DASK/komisyon/tapu harcı korunur)", () => {
    const r = computePurchaseCosts({ price: 6_000_000, sqm: 130, downPayment: 6_000_000 });
    expect(r.lines.some((l) => l.key === "deed_fee")).toBe(true);
    expect(r.lines.some((l) => l.key === "commission")).toBe(true);
    expect(r.lines.some((l) => l.key === "dask")).toBe(true);
    expect(r.totalCosts).toBeGreaterThan(0);
  });

  it("DEFAULT_RATES yeni oranları içerir", () => {
    expect(DEFAULT_RATES.newBuildVatResidentialSmallPct).toBe(1);
    expect(DEFAULT_RATES.newBuildVatLargePct).toBe(20);
    expect(DEFAULT_RATES.rentWithholdingPct).toBe(20);
  });
});
