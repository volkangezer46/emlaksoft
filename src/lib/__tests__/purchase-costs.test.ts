import { describe, expect, it } from "vitest";
import {
  APPROX_DISCLAIMER,
  DEFAULT_RATES,
  MAX_LOAN_TO_VALUE_PCT,
  annualToMonthlyPct,
  computeLoanPlan,
  computePurchaseCosts,
  formatTry,
  monthlyToAnnualPct,
} from "@/lib/purchase-costs";

const line = (res: ReturnType<typeof computePurchaseCosts>, key: string) =>
  res.lines.find((l) => l.key === key);

describe("computePurchaseCosts — tapu harcı", () => {
  it("varsayılan paylaşımda alıcı toplam %4'ün yarısını (%2) öder", () => {
    const res = computePurchaseCosts({ price: 5_000_000, downPayment: 5_000_000 });
    expect(line(res, "deed_fee")?.amount).toBe(100_000); // 5.000.000 × %2
  });

  it("'buyer' seçildiğinde harcın tamamı (%4) alıcıya yazılır — tam iki katı", () => {
    const half = computePurchaseCosts({ price: 5_000_000, deedFeeShare: "half" });
    const buyer = computePurchaseCosts({ price: 5_000_000, deedFeeShare: "buyer" });
    expect(buyer.lines.find((l) => l.key === "deed_fee")?.amount).toBe(200_000);
    expect(buyer.totalCosts - half.totalCosts).toBe(100_000);
  });
});

describe("computePurchaseCosts — komisyon", () => {
  it("satışta komisyon = bedel × oran × (1+KDV)", () => {
    const res = computePurchaseCosts({ price: 4_000_000, commissionPct: 2, vatPct: 20 });
    // 4.000.000 × %2 = 80.000 → + %20 KDV = 96.000
    expect(line(res, "commission")?.amount).toBe(96_000);
  });

  it("kiralıkta komisyon bir aylık kira + KDV, tapu/döner sermaye kalemi çıkmaz", () => {
    const res = computePurchaseCosts({ price: 30_000, transactionType: "rent", vatPct: 20 });
    expect(line(res, "commission")?.amount).toBe(36_000); // 30.000 × 1 ay × 1,20
    expect(line(res, "deed_fee")).toBeUndefined();
    expect(line(res, "land_registry_service")).toBeUndefined();
    expect(res.loanAmount).toBe(0);
    expect(res.notes.some((n) => n.includes("Depozito"))).toBe(true);
  });
});

describe("computePurchaseCosts — kredi kalemleri", () => {
  it("kredi yoksa tahsis/ekspertiz/ipotek kalemleri hiç eklenmez", () => {
    const res = computePurchaseCosts({ price: 3_000_000, downPayment: 3_000_000 });
    expect(res.loanAmount).toBe(0);
    for (const key of ["appraisal", "loan_allocation", "mortgage_registration", "home_insurance"]) {
      expect(line(res, key)).toBeUndefined();
    }
  });

  it("kredi varsa tahsis ücreti kredi tutarının binde 5'i olur ve peşinat türetilir", () => {
    const res = computePurchaseCosts({ price: 4_000_000, downPayment: 1_000_000 });
    expect(res.loanAmount).toBe(3_000_000);
    expect(line(res, "loan_allocation")?.amount).toBe(15_000); // 3.000.000 × %0,5
    expect(line(res, "appraisal")?.amount).toBe(DEFAULT_RATES.appraisalFeeTry);
    expect(res.loanToValuePct).toBe(75);
    expect(res.exceedsLoanToValue).toBe(false);
  });

  it("LTV yasal sınırı aşınca uyarı bayrağı kalkar", () => {
    const res = computePurchaseCosts({ price: 1_000_000, downPayment: 50_000 });
    expect(res.loanToValuePct).toBeGreaterThan(MAX_LOAN_TO_VALUE_PCT);
    expect(res.exceedsLoanToValue).toBe(true);
  });
});

describe("computePurchaseCosts — DASK", () => {
  it("m² verilirse doğrusal, alt/üst sınırla kırpılır", () => {
    const small = computePurchaseCosts({ price: 1_000_000, sqm: 10 }); // 250 → min 900
    const mid = computePurchaseCosts({ price: 1_000_000, sqm: 120 }); // 3.000
    const huge = computePurchaseCosts({ price: 1_000_000, sqm: 1_000 }); // 25.000 → tavan
    expect(line(small, "dask")?.amount).toBe(DEFAULT_RATES.daskMinTry);
    expect(line(mid, "dask")?.amount).toBe(3_000);
    expect(line(huge, "dask")?.amount).toBe(DEFAULT_RATES.daskMaxTry);
  });

  it("m² yoksa sabit tahmine düşer", () => {
    const res = computePurchaseCosts({ price: 1_000_000 });
    expect(line(res, "dask")?.amount).toBe(DEFAULT_RATES.daskFallbackTry);
  });
});

describe("computePurchaseCosts — toplam tutarlılık", () => {
  it("kalem toplamı totalCosts'a, peşinat + masraf cepten çıkana eşit", () => {
    const res = computePurchaseCosts({ price: 6_750_000, downPayment: 2_000_000, sqm: 135 });
    const sum = res.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.abs(sum - res.totalCosts)).toBeLessThan(0.01);
    expect(res.cashOutOfPocket).toBeCloseTo(res.downPayment + res.totalCosts, 2);
    expect(res.downPayment + res.loanAmount).toBeCloseTo(res.price, 2);
    expect(res.costsPctOfPrice).toBeCloseTo((res.totalCosts / res.price) * 100, 2);
  });

  it("peşinat fiyatı aşarsa kırpılır, kredi negatife düşmez", () => {
    const res = computePurchaseCosts({ price: 1_000_000, downPayment: 5_000_000 });
    expect(res.downPayment).toBe(1_000_000);
    expect(res.loanAmount).toBe(0);
  });

  it("fiyat 0 / geçersizken çökmeden sıfır döner", () => {
    const res = computePurchaseCosts({ price: 0 });
    expect(res.price).toBe(0);
    expect(res.costsPctOfPrice).toBe(0);
    expect(line(res, "deed_fee")).toBeUndefined();
  });
});

describe("computeLoanPlan — annüite", () => {
  it("bilinen değer: 100.000 ₺ / aylık %1 / 12 ay → 8.884,88 ₺ taksit", () => {
    const plan = computeLoanPlan({ amount: 100_000, monthlyRatePct: 1, months: 12 });
    expect(plan.monthlyPayment).toBeCloseTo(8_884.88, 2);
    expect(plan.totalPayment).toBeCloseTo(106_618.55, 0);
    expect(plan.totalInterest).toBeCloseTo(plan.totalPayment - plan.amount, 1);
  });

  it("yıllık faiz aylığa bölünür — yıllık %12 ile aylık %1 aynı taksiti verir", () => {
    const a = computeLoanPlan({ amount: 100_000, annualRatePct: 12, months: 12 });
    const b = computeLoanPlan({ amount: 100_000, monthlyRatePct: 1, months: 12 });
    expect(a.monthlyPayment).toBe(b.monthlyPayment);
    expect(annualToMonthlyPct(12)).toBe(1);
    expect(monthlyToAnnualPct(2.5)).toBe(30);
  });

  it("sıfır faizde taksit = anapara / vade, toplam faiz 0", () => {
    const plan = computeLoanPlan({ amount: 120_000, monthlyRatePct: 0, months: 24 });
    expect(plan.monthlyPayment).toBe(5_000);
    expect(plan.totalInterest).toBe(0);
    expect(plan.totalPayment).toBe(120_000);
  });

  it("sıfır kredi / sıfır vade boş plan döndürür", () => {
    expect(computeLoanPlan({ amount: 0, monthlyRatePct: 2, months: 120 }).monthlyPayment).toBe(0);
    expect(computeLoanPlan({ amount: 500_000, monthlyRatePct: 2, months: 0 }).amortizationSchedule).toHaveLength(0);
  });

  it("ilk taksitte faiz payı anapara payından büyüktür, ilk 3 satır döner", () => {
    const plan = computeLoanPlan({ amount: 3_000_000, monthlyRatePct: 2.79, months: 120 });
    expect(plan.firstPayments).toHaveLength(3);
    const first = plan.firstPayments[0];
    expect(first.interest).toBeCloseTo(3_000_000 * 0.0279, 2);
    expect(first.interest).toBeGreaterThan(first.principal);
    // Ödeme ilerledikçe faiz azalır, anapara artar
    expect(plan.firstPayments[2].interest).toBeLessThan(first.interest);
    expect(plan.firstPayments[2].principal).toBeGreaterThan(first.principal);
  });

  it("ödeme planı anaparayı tam kapatır — son taksitte bakiye 0", () => {
    const plan = computeLoanPlan({ amount: 1_000_000, monthlyRatePct: 1.75, months: 36, scheduleRows: 36 });
    expect(plan.amortizationSchedule).toHaveLength(36);
    const last = plan.amortizationSchedule[35];
    expect(last.balance).toBe(0);
    const principalSum = plan.amortizationSchedule.reduce((s, r) => s + r.principal, 0);
    expect(principalSum).toBeCloseTo(1_000_000, 2);
  });

  it("varsayılan olarak yalnızca ilk 12 satır döner ve KKDF/BSMV notu taşınır", () => {
    const plan = computeLoanPlan({ amount: 2_000_000, monthlyRatePct: 2.5, months: 120 });
    expect(plan.amortizationSchedule).toHaveLength(12);
    expect(plan.note).toMatch(/KKDF/);
    expect(plan.annualRatePct).toBe(30);
  });
});

describe("biçimlendirme", () => {
  it("formatTry kuruşsuz ₺ üretir, geçersizde tire", () => {
    expect(formatTry(1_234_567.4)).toContain("₺");
    expect(formatTry(Number.NaN)).toBe("—");
    expect(APPROX_DISCLAIMER).toMatch(/yaklaşık/);
  });
});
