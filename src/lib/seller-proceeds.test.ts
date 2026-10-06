import { describe, expect, it } from "vitest";
import { computeSellerProceeds } from "./seller-proceeds";

const base = { salePrice: 5_000_000, acquisitionPrice: 3_000_000, holdingMonths: 36 };

describe("computeSellerProceeds", () => {
  it("5 yıldan kısa elde tutmada değer artışı vergisini kademeli hesaplar", () => {
    const r = computeSellerProceeds(base);
    expect(r.estimate).toBe(true);
    expect(r.deedFee).toBe(100_000); // %4 toplamın yarısı
    expect(r.commissionNet).toBe(100_000); // tavanın yarısı %2
    expect(r.commissionVat).toBe(20_000);
    expect(r.withinTaxWindow).toBe(true);
    expect(r.gain).toBe(1_800_000); // 5.0M - 3.0M - (harç 100K + komisyon 100K)
    expect(r.exemptionApplied).toBe(150_000);
    expect(r.taxableGain).toBe(1_650_000);
    expect(r.incomeTax).toBe(482_500);
    expect(r.netBeforeTax).toBe(4_780_000);
    expect(r.netProceeds).toBe(4_297_500);
  });

  it("60 ay ve üstünde vergi çıkmaz", () => {
    const r = computeSellerProceeds({ ...base, holdingMonths: 60 });
    expect(r.withinTaxWindow).toBe(false);
    expect(r.incomeTax).toBe(0);
    expect(r.netProceeds).toBe(4_780_000);
  });

  it("59 ay hâlâ vergi penceresinde", () => {
    expect(computeSellerProceeds({ ...base, holdingMonths: 59 }).withinTaxWindow).toBe(true);
  });

  it("Yİ-ÜFE artışı eşiği aşarsa alış bedeli endekslenir; aşmazsa endekslenmez", () => {
    const up = computeSellerProceeds({ ...base, ufeIncreasePct: 50 });
    expect(up.indexedAcquisitionCost).toBe(4_500_000);
    expect(up.gain).toBe(300_000);
    expect(up.taxableGain).toBe(150_000);
    expect(up.incomeTax).toBe(22_500);
    const low = computeSellerProceeds({ ...base, ufeIncreasePct: 8 });
    expect(low.indexedAcquisitionCost).toBe(3_000_000);
  });

  it("kazanç yıllık istisna içinde kalırsa vergi çıkmaz; kullanılmış istisna düşülür", () => {
    const small = computeSellerProceeds({ salePrice: 3_300_000, acquisitionPrice: 3_000_000, holdingMonths: 12, deedFeeShare: "none", commissionPct: 0 });
    expect(small.gain).toBe(300_000);
    expect(small.incomeTax).toBe(22_500); // istisna sonrası matrah 150K x %15
    expect(small.taxableGain).toBe(150_000);
    const used = computeSellerProceeds({ salePrice: 3_300_000, acquisitionPrice: 3_000_000, holdingMonths: 12, deedFeeShare: "none", commissionPct: 0, exemptionAlreadyUsed: 150_000 });
    expect(used.exemptionApplied).toBe(0);
    expect(used.taxableGain).toBe(300_000);
    const within = computeSellerProceeds({ salePrice: 3_100_000, acquisitionPrice: 3_000_000, holdingMonths: 12, deedFeeShare: "none", commissionPct: 0 });
    expect(within.gain).toBe(100_000);
    expect(within.incomeTax).toBe(0);
  });

  it("diğer gelir matrahı vergi dilimini yükseltir", () => {
    const a = computeSellerProceeds({ ...base, otherTaxableIncome: 0 });
    const b = computeSellerProceeds({ ...base, otherTaxableIncome: 1_000_000 });
    expect(b.incomeTax).toBeGreaterThan(a.incomeTax);
  });

  it("zarar durumunda kazanç ve vergi 0, kredi nete yansır", () => {
    const r = computeSellerProceeds({ salePrice: 2_000_000, acquisitionPrice: 3_000_000, holdingMonths: 12, outstandingLoan: 500_000 });
    expect(r.gain).toBe(0);
    expect(r.incomeTax).toBe(0);
    expect(r.netProceeds).toBe(r.salePrice - r.deedFee - r.commissionNet - r.commissionVat - 500_000);
  });

  it("alış bedeli yoksa uyarı verir; geçersiz girdiler 0 sayılır", () => {
    const r = computeSellerProceeds({ salePrice: 1_000_000, acquisitionPrice: 0, holdingMonths: 6 });
    expect(r.warnings.join(" ")).toMatch(/Alış bedeli girilmedi/);
    const bad = computeSellerProceeds({ salePrice: Number.NaN, acquisitionPrice: -5, holdingMonths: Number.NaN });
    expect(bad.netProceeds).toBe(0);
    expect(bad.warnings.join(" ")).toMatch(/Satış bedeli girilmedi/);
  });

  it("DKV eşiği yalnız uyarıdır, vergi satırı üretmez", () => {
    const r = computeSellerProceeds({ salePrice: 20_000_000, acquisitionPrice: 19_900_000, holdingMonths: 80 });
    expect(r.dkvWarning).toBe(true);
    expect(r.usedConstants).toContain("dkvThresholdTry");
    expect(r.lines.some((l) => /değerli konut/i.test(l.label))).toBe(false);
    expect(computeSellerProceeds(base).dkvWarning).toBe(false);
  });

  it("kullanılan sabitler rozet için raporlanır", () => {
    const r = computeSellerProceeds(base);
    expect(r.usedConstants).toEqual(expect.arrayContaining(["deedFeeTotalPct", "vatGeneralPct", "valueGainExemptionTry"]));
    expect(r.usedTables).toContain("income_tax");
  });
});
