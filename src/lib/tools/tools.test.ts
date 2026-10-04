import { describe, expect, it } from "vitest";
import { computeCommissionTool } from "./commission-tool";
import { computeLoanTool } from "./loan-tool";
import { computePurchaseTool } from "./purchase-cost-tool";
import { computeRentalYield } from "./rental-yield";
import { TOOLS, publishedTools } from "./registry";

describe("komisyon aracı", () => {
  it("1.000.000 TL, %2, KDV hariç: matrah 20.000, KDV 4.000, toplam 24.000", () => {
    const r = computeCommissionTool({ price: "1.000.000", rate: "2", vatRate: "20", vatIncluded: false });
    expect(r).toMatchObject({ status: "ok", net: 20000, vat: 4000, gross: 24000 });
  });
  it("KDV dahil: 20.000 brüt -> matrah 16.666,67", () => {
    const r = computeCommissionTool({ price: "1000000", rate: "2", vatRate: "20", vatIncluded: true });
    expect(r).toMatchObject({ status: "ok", net: 16666.67 });
  });
  it("virgüllü oran okunur, geçersiz ve boş ayrılır", () => {
    expect(computeCommissionTool({ price: "1000000", rate: "2,5", vatRate: "20", vatIncluded: false })).toMatchObject({ net: 25000 });
    expect(computeCommissionTool({ price: "abc", rate: "2", vatRate: "", vatIncluded: false })).toEqual({ status: "invalid", fields: ["price"] });
    expect(computeCommissionTool({ price: "", rate: "", vatRate: "", vatIncluded: false })).toEqual({ status: "empty" });
    expect(computeCommissionTool({ price: "100", rate: "-1", vatRate: "", vatIncluded: false }).status).toBe("invalid");
  });
});

describe("kira getirisi", () => {
  it("5.000.000 TL, 25.000 TL/ay: brüt %6, geri dönüş 16,67 yıl", () => {
    const r = computeRentalYield({ price: "5.000.000", monthlyRent: "25.000", yearlyExpenses: "" });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.grossYieldPct).toBeCloseTo(6, 10);
    expect(r.grossPaybackYears).toBeCloseTo(5_000_000 / 300_000, 10);
    expect(r.netYieldPct).toBeNull();
  });
  it("gider ile net: (300.000-60.000)/5.000.000 = %4,8", () => {
    const r = computeRentalYield({ price: "5000000", monthlyRent: "25000", yearlyExpenses: "60000" });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.netYieldPct).toBeCloseTo(4.8, 10);
    expect(r.netPaybackYears).toBeCloseTo(5_000_000 / 240_000, 10);
  });
  it("sıfır reddedilir", () => {
    expect(computeRentalYield({ price: "0", monthlyRent: "1", yearlyExpenses: "" }).status).toBe("invalid");
  });
});

describe("kredi taksit", () => {
  it("1.000.000 TL, aylık %2, 12 ay: taksit bağımsız formülle eşleşir (~94.559,60)", () => {
    const i = 0.02;
    const n = 12;
    const expected = (1_000_000 * i) / (1 - Math.pow(1 + i, -n));
    const r = computeLoanTool({ amount: "1000000", monthlyRatePct: "2", months: "12" });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.monthlyPayment).toBeCloseTo(expected, 2);
    expect(r.monthlyPayment).toBeCloseTo(94559.6, 1);
    expect(r.totalPayment).toBeCloseTo(expected * 12, 0);
    expect(r.totalInterest).toBeCloseTo(r.totalPayment - 1_000_000, 2);
    expect(r.schedule).toHaveLength(12);
    expect(r.schedule[0]!.interest).toBeCloseTo(20000, 2);
  });
  it("faiz 0 -> doğrusal; faiz boşsa hesap yok; kesirli vade geçersiz", () => {
    expect(computeLoanTool({ amount: "120000", monthlyRatePct: "0", months: "12" })).toMatchObject({
      status: "ok",
      monthlyPayment: 10000,
      totalInterest: 0,
    });
    expect(computeLoanTool({ amount: "120000", monthlyRatePct: "", months: "12" })).toEqual({ status: "empty" });
    expect(computeLoanTool({ amount: "120000", monthlyRatePct: "2", months: "12,5" }).status).toBe("invalid");
  });
});

describe("tapu/alım masrafı", () => {
  it("%4 harcın yarısı alıcıda: 2.000.000 TL -> 40.000; komisyon boşsa kalem yok", () => {
    const r = computePurchaseTool({ price: "2.000.000", deedTotalPct: "4", deedShare: "half", serviceFee: "", commissionPct: "", vatPct: "" });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.lines.map((l) => l.key)).toEqual(["deed_fee"]);
    expect(r.totalCosts).toBe(40000);
  });
  it("alıcı tümünü öder + hizmet bedeli + komisyon %2 + KDV %20", () => {
    const r = computePurchaseTool({ price: "1000000", deedTotalPct: "4", deedShare: "buyer", serviceFee: "5000", commissionPct: "2", vatPct: "20" });
    if (r.status !== "ok") throw new Error("ok bekleniyordu");
    expect(r.totalCosts).toBe(40000 + 5000 + 24000);
  });
});

describe("araç kaydı", () => {
  it("kira artış aracı kayıtta yok; dört araç yayında", () => {
    expect(TOOLS.some((t) => (t.slug as string) === "kira-artis-hesaplama")).toBe(false);
    expect(publishedTools().map((t) => t.slug)).toEqual([
      "komisyon-hesaplama",
      "tapu-masrafi-hesaplama",
      "kira-getirisi-hesaplama",
      "konut-kredisi-taksit-hesaplama",
    ]);
  });
});
