import { describe, expect, it } from "vitest";
import {
  INVESTMENT_DEFAULTS,
  INVESTMENT_DISCLAIMER,
  approximateIrr,
  computeCashFlow,
  computeRentalYield,
  estimateMonthlyRent,
  formatPct,
  formatYears,
  monthlyPropertyTax,
  projectYears,
} from "@/lib/investment";
import { computeLoanPlan } from "@/lib/purchase-costs";

/** Testlerde tekrar eden temel senaryo: 6.000.000 ₺ daire, 25.000 ₺ kira. */
const PRICE = 6_000_000;
const RENT = 25_000;

/** Tüm oranları kapatır — formülün çıplak hâlini sınamak için. */
const NO_COSTS = {
  vacancyPct: 0,
  maintenancePct: 0,
  managementPct: 0,
  taxPct: 0,
  propertyTaxPerMille: 0,
};

describe("computeRentalYield — brüt getiri ve kira çarpanı", () => {
  it("bilinen değerle brüt getiri: 25.000 ₺/ay, 6.000.000 ₺ → %5", () => {
    const res = computeRentalYield({ price: PRICE, monthlyRent: RENT });
    expect(res.annualRent).toBe(300_000);
    expect(res.grossYieldPct).toBe(5);
  });

  it("kira çarpanı = fiyat / yıllık kira → 20 yılda amorti", () => {
    const res = computeRentalYield({ price: PRICE, monthlyRent: RENT });
    expect(res.rentMultiplier).toBe(20);
    // Gider yoksa net amorti süresi brüt çarpanla aynı olmalı.
    expect(res.netPaybackYears).toBe(20);
    // Çarpan ile brüt getiri birbirinin tersi: 100 / 20 = 5.
    expect(100 / res.rentMultiplier).toBeCloseTo(res.grossYieldPct, 6);
  });

  it("yıllık gider net getiriyi düşürür ve amorti süresini uzatır", () => {
    const res = computeRentalYield({ price: PRICE, monthlyRent: RENT, annualCostsTry: 60_000 });
    expect(res.netYieldPct).toBe(4); // (300.000 − 60.000) / 6.000.000
    expect(res.netPaybackYears).toBe(25); // 6.000.000 / 240.000
    expect(res.monthlyNet).toBe(20_000);
  });

  it("gider kirayı aşarsa amorti etmez (null) ve net getiri negatif okunur", () => {
    const res = computeRentalYield({ price: PRICE, monthlyRent: RENT, annualCostsTry: 400_000 });
    expect(res.netYieldPct).toBe(-1.67);
    expect(res.netPaybackYears).toBeNull();
    expect(formatYears(res.netPaybackYears)).toBe("Amorti etmiyor");
  });

  it("fiyat ya da kira 0 iken bölme hatası üretmez", () => {
    expect(computeRentalYield({ price: 0, monthlyRent: RENT }).grossYieldPct).toBe(0);
    expect(computeRentalYield({ price: PRICE, monthlyRent: 0 }).rentMultiplier).toBe(0);
  });
});

describe("computeCashFlow — sıfır kredi (peşin alım)", () => {
  it("kredi yokken aylık nakit akışı = tahsil edilen kira (gider kapalıyken)", () => {
    const res = computeCashFlow({
      price: PRICE,
      downPayment: PRICE,
      loanMonths: 0,
      monthlyRent: RENT,
      ...NO_COSTS,
    });
    expect(res.loanAmount).toBe(0);
    expect(res.monthlyLoanPayment).toBe(0);
    expect(res.monthlyCashFlow).toBe(RENT);
    expect(res.breakEvenRent).toBe(0); // ödenecek hiçbir şey yok
  });

  it("varsayılan oranlarla peşin alımda gider kalemleri tek tek çıkar", () => {
    const res = computeCashFlow({
      price: PRICE,
      downPayment: PRICE,
      loanMonths: 0,
      monthlyRent: RENT,
    });
    // boşluk %5 → 23.750 tahsil; bakım %10 → 2.375; emlak vergisi binde 1 → 500/ay
    expect(res.effectiveMonthlyRent).toBe(23_750);
    expect(res.expenseLines.find((l) => l.key === "maintenance")?.amount).toBe(2_375);
    expect(res.expenseLines.find((l) => l.key === "property_tax")?.amount).toBe(500);
    // Varsayılan yönetim %0 ve vergi %0 → satır hiç basılmaz.
    expect(res.expenseLines.find((l) => l.key === "management")).toBeUndefined();
    expect(res.expenseLines.find((l) => l.key === "rent_tax")).toBeUndefined();
    expect(res.monthlyCashFlow).toBe(20_875); // 23.750 − 2.375 − 500
  });
});

describe("computeCashFlow — kredi ve negatif nakit akışı", () => {
  it("yüksek taksitte nakit akışı negatiftir ve taksit purchase-costs'tan gelir", () => {
    const res = computeCashFlow({
      price: PRICE,
      downPayment: 1_500_000,
      loanMonths: 120,
      monthlyRatePct: 2.79,
      monthlyRent: RENT,
      ...NO_COSTS,
    });
    const loan = computeLoanPlan({ amount: 4_500_000, months: 120, monthlyRatePct: 2.79 });
    // Aynı annüite motoru — bu modül kendi taksit formülünü yazmaz.
    expect(res.monthlyLoanPayment).toBe(loan.monthlyPayment);
    expect(res.monthlyCashFlow).toBeLessThan(0);
    expect(res.monthlyCashFlow).toBe(Math.round((RENT - loan.monthlyPayment) * 100) / 100);
    expect(res.cashOnCashPct).toBeLessThan(0);
  });

  it("başabaş kira, nakit akışını tam sıfırlayan kiradır", () => {
    const args = {
      price: PRICE,
      downPayment: 1_500_000,
      loanMonths: 120,
      monthlyRatePct: 2.79,
      monthlyRent: RENT,
      vacancyPct: 5,
      maintenancePct: 10,
      managementPct: 5,
      taxPct: 0,
      propertyTaxPerMille: 1,
    };
    const base = computeCashFlow(args);
    const atBreakEven = computeCashFlow({ ...args, monthlyRent: base.breakEvenRent });
    expect(atBreakEven.monthlyCashFlow).toBeCloseTo(0, 1);
    // Başabaş kira, girilen kiranın çok üstünde → yatırımcı her ay cebinden koyar.
    expect(base.breakEvenRent).toBeGreaterThan(RENT);
  });
});

describe("computeCashFlow — boşluk oranı etkisi", () => {
  it("boşluk %10 iken tahsil edilen kira ve nakit akışı tam %10 düşer", () => {
    const args = { price: PRICE, downPayment: PRICE, loanMonths: 0, monthlyRent: RENT, ...NO_COSTS };
    const full = computeCashFlow(args);
    const vacant = computeCashFlow({ ...args, vacancyPct: 10 });
    expect(vacant.effectiveMonthlyRent).toBe(22_500);
    expect(full.monthlyCashFlow - vacant.monthlyCashFlow).toBe(2_500);
    expect(vacant.expenseLines.find((l) => l.key === "vacancy")?.amount).toBe(2_500);
  });

  it("boşluk %100 iken kira geliri sıfırlanır, emlak vergisi yine de gider yazılır", () => {
    const res = computeCashFlow({
      price: PRICE,
      downPayment: PRICE,
      loanMonths: 0,
      monthlyRent: RENT,
      vacancyPct: 100,
      maintenancePct: 10,
      managementPct: 0,
      taxPct: 0,
    });
    expect(res.effectiveMonthlyRent).toBe(0);
    expect(res.monthlyCashFlow).toBe(-monthlyPropertyTax(PRICE, INVESTMENT_DEFAULTS.propertyTaxPerMille));
  });
});

describe("projectYears — 10 yıllık projeksiyon", () => {
  const projArgs = {
    price: PRICE,
    downPayment: 1_500_000,
    loanMonths: 120,
    monthlyRatePct: 2.79,
    monthlyRent: RENT,
    ...NO_COSTS,
  };

  it("kümülatif nakit, yıllık net nakitlerin toplamına birebir eşittir", () => {
    const res = projectYears({ ...projArgs, rentGrowthPct: 25, priceGrowthPct: 20 });
    expect(res.years).toHaveLength(10);
    let sum = 0;
    for (const row of res.years) {
      sum = Math.round((sum + row.netCash) * 100) / 100;
      expect(row.cumulativeCash).toBeCloseTo(sum, 2);
      // Özsermaye tanımı her satırda tutmalı.
      expect(row.equity).toBeCloseTo(row.estimatedValue - row.remainingPrincipal, 2);
      expect(row.totalReturn).toBeCloseTo(row.equity + row.cumulativeCash - res.initialCash, 2);
    }
  });

  it("sıfır büyümede kira, değer ve net nakit yıllar boyunca sabit kalır", () => {
    const res = projectYears({ ...projArgs, rentGrowthPct: 0, priceGrowthPct: 0 });
    for (const row of res.years) {
      expect(row.monthlyRent).toBe(RENT);
      expect(row.estimatedValue).toBe(PRICE);
      expect(row.rentIncome).toBe(RENT * 12);
    }
    // Kredi 120 ay = tam 10 yıl sürdüğü için net nakit de her yıl aynı olmalı.
    // Son taksit kalan anaparayı tam kapatacak şekilde düzeltildiğinden
    // (bkz. computeLoanPlan) 10. yılda birkaç liralık yuvarlama farkı normaldir.
    const first = res.years[0].netCash;
    expect(Math.abs(res.years[9].netCash - first)).toBeLessThan(10);
    // 10. yıl sonunda kredi kapanır.
    expect(res.years[9].remainingPrincipal).toBe(0);
  });

  it("kredi bitince nakit akışı sıçrar — taksit düşer, kira kalır", () => {
    const res = projectYears({
      ...projArgs,
      loanMonths: 36,
      years: 5,
      rentGrowthPct: 0,
      priceGrowthPct: 0,
    });
    expect(res.years[2].debtService).toBeGreaterThan(0); // 3. yıl hâlâ taksit var
    expect(res.years[3].debtService).toBe(0); // 4. yıl kredi bitti
    expect(res.years[3].netCash).toBeGreaterThan(res.years[2].netCash);
    // Sıçrama tam olarak bir yıllık taksit kadar (kira sabit varsayıldı).
    expect(res.years[3].netCash - res.years[2].netCash).toBeCloseTo(res.years[2].debtService, 0);
    expect(res.years[3].remainingPrincipal).toBe(0);
  });

  it("başlangıç nakdi peşinat + alım masraflarıdır; kapatılınca sadece peşinat kalır", () => {
    const withCosts = projectYears(projArgs);
    const without = projectYears({ ...projArgs, includePurchaseCosts: false });
    expect(without.purchaseCosts).toBe(0);
    expect(without.initialCash).toBe(1_500_000);
    expect(withCosts.purchaseCosts).toBeGreaterThan(0);
    expect(withCosts.initialCash).toBe(1_500_000 + withCosts.purchaseCosts);
  });

  it("peşin alım + kira artışında amorti yılı ve pozitif IRR üretir", () => {
    const res = projectYears({
      price: PRICE,
      downPayment: PRICE,
      loanMonths: 0,
      monthlyRent: RENT,
      years: 20,
      rentGrowthPct: 0,
      priceGrowthPct: 0,
      includePurchaseCosts: false,
      ...NO_COSTS,
    });
    // Yıllık 300.000 ₺ nakit, 6.000.000 ₺ yatırım → 20. yılda tam kapanır.
    expect(res.cashPaybackYear).toBe(20);
    expect(res.firstPositiveCashYear).toBe(1);
    // Değer sabit varsayıldığı hâlde kira geliri olduğu için IRR pozitif.
    expect(res.approxIrrPct).not.toBeNull();
    expect(res.approxIrrPct as number).toBeGreaterThan(0);
  });

  it("kira hiç yoksa amorti gerçekleşmez ve nakit akışı hep negatiftir", () => {
    const res = projectYears({ ...projArgs, monthlyRent: 0, rentGrowthPct: 0, priceGrowthPct: 0 });
    expect(res.cashPaybackYear).toBeNull();
    expect(res.firstPositiveCashYear).toBeNull();
    expect(res.years.every((r) => r.netCash <= 0)).toBe(true);
  });
});

describe("approximateIrr — ikiye bölme kökü", () => {
  it("tek dönemli seride kesin sonucu bulur: −100 → +110 ⇒ %10", () => {
    expect(approximateIrr([-100, 110])).toBeCloseTo(0.1, 6);
  });

  it("hiç pozitif akış yoksa kök bulunamaz → null", () => {
    expect(approximateIrr([-100, -10, -10])).toBeNull();
  });
});

describe("yardımcılar", () => {
  it("kira tahmini fiyatın binde 4'üdür", () => {
    expect(estimateMonthlyRent(5_000_000)).toBe(20_000);
    expect(estimateMonthlyRent(5_000_000, 3)).toBe(15_000);
    expect(estimateMonthlyRent(0)).toBe(0);
  });

  it("emlak vergisi aylık karşılığı binde orandan gelir", () => {
    expect(monthlyPropertyTax(6_000_000, 1)).toBe(500);
    expect(monthlyPropertyTax(6_000_000, 2)).toBe(1_000); // büyükşehir
  });

  it("yüzde ve yıl biçimleri Türkçe ayraç kullanır", () => {
    expect(formatPct(5.25)).toBe("%5,3");
    expect(formatYears(20)).toBe("20 yıl");
    expect(formatYears(0)).toBe("Amorti etmiyor");
  });

  it("uyarı metni 'resmi teklif değildir' ifadesini taşır", () => {
    expect(INVESTMENT_DISCLAIMER).toContain("resmi teklif");
  });
});
