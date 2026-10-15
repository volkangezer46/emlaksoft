import { describe, expect, it } from "vitest";
import {
  addMonths,
  budgetTotals,
  budgetVsActualRows,
  cashPnlAdjustments,
  categoryAmounts,
  countByMonth,
  customCategoryKey,
  monthBounds,
  parseMonthKey,
  parseRatePct,
  pnlCashMonths,
  pnlExtraExpense,
  rentWithholdingBreakdown,
  sumCategoryRecords,
  vatBreakdown,
  vatSummaryRows,
  vatTotals,
} from "./expense-budget";

describe("bütçe ↔ gerçekleşen (finance_budget_vs_actual)", () => {
  const raw = [
    { direction: "out", category: "kira", budget: "40000", actual: "42000" },
    { direction: "out", category: "reklam", budget: 10000, actual: 8500 },
    { direction: "out", category: "ulasim", budget: 5000, actual: 1000 },
    { direction: "out", category: "ofis", budget: 0, actual: 750 },
    { direction: "out", category: "bos", budget: 0, actual: 0 },
    { direction: "in", category: "komisyon", budget: 200000, actual: 120000 },
    { direction: "in", category: "hizmet_bedeli", budget: 10000, actual: 12000 },
  ];
  const rows = budgetVsActualRows(raw);

  it("durumları ve sırayı üretir; bütçesi ve gerçekleşeni olmayan satır atılır", () => {
    expect(rows.map((r) => `${r.direction}:${r.category}:${r.status}`)).toEqual([
      "in:hizmet_bedeli:ok",
      "in:komisyon:under",
      "out:kira:over",
      "out:reklam:warn",
      "out:ulasim:ok",
      "out:ofis:ok",
    ]);
    expect(rows.find((r) => r.category === "kira")?.remaining).toBe(-2000);
  });

  it("toplamlar bütçe, bütçeli gerçekleşen ve aşım sayısını verir (RPC ile tutarlı)", () => {
    expect(budgetTotals(rows, "out")).toEqual({ budget: 55000, actual: 52250, budgetedActual: 51500, over: 1 });
    expect(budgetTotals(rows, "in")).toEqual({ budget: 210000, actual: 132000, budgetedActual: 132000, over: 0 });
  });

  it("mülk sahibinin parası (kira/aidat tahsilatı) ve transfer gelir gerçekleşenini şişirmez", () => {
    const withPassThrough = budgetVsActualRows([
      ...raw,
      { direction: "in", category: "kira_tahsilat", budget: 0, actual: 90000 },
      { direction: "in", category: "aidat_tahsilat", budget: 0, actual: 5000 },
      { direction: "in", category: "transfer", budget: 0, actual: 1000 },
      { direction: "out", category: "transfer", budget: 0, actual: 300 },
    ]);
    expect(withPassThrough.some((r) => r.direction === "in" && ["kira_tahsilat", "aidat_tahsilat", "transfer"].includes(r.category))).toBe(false);
    expect(budgetTotals(withPassThrough, "in").actual).toBe(132000);
  });
});

describe("ay yardımcıları", () => {
  it("ay anahtarı doğrulanır, sınırlar ve kaydırma doğru", () => {
    expect(parseMonthKey("2026-02", "2026-10")).toBe("2026-02");
    expect(parseMonthKey("2026-13", "2026-10")).toBe("2026-10");
    expect(parseMonthKey("x", "2026-10")).toBe("2026-10");
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });
});

describe("KDV özeti", () => {
  it("ödenecek = hesaplanan − indirilecek (RPC payable'ı yok sayılır); eksi devreden", () => {
    const rows = vatSummaryRows([
      { month: "2026-02-01", output_vat: "1000", input_vat: "250.5", payable: 999, withholding_paid: 2000, withholding_collected: 0 },
      { month: "2026-01-01", output_vat: 100, input_vat: 300, payable: 0, withholding_paid: null, withholding_collected: "50" },
    ]);
    expect(rows.map((r) => [r.month, r.payable])).toEqual([
      ["2026-01", -200],
      ["2026-02", 749.5],
    ]);
    expect(vatTotals(rows)).toEqual({ outputVat: 1100, inputVat: 550.5, payable: 549.5, withholdingPaid: 2000, withholdingCollected: 50 });
  });

  it("KDV bilgisi olmayan hareketler aya göre sayılır", () => {
    expect([...countByMonth(["2026-01-05", "2026-01-31", "2026-03-01", null, "bozuk"])]).toEqual([
      ["2026-01", 2],
      ["2026-03", 1],
    ]);
  });
});

describe("kâr/zarar defter eki (finance_pnl)", () => {
  it("kategori jsonb'si nesne, dizi ya da metin olabilir", () => {
    expect(Object.fromEntries(categoryAmounts({ komisyon: "100", hizmet_bedeli: 50 }))).toEqual({ komisyon: 100, hizmet_bedeli: 50 });
    expect(Object.fromEntries(categoryAmounts([{ category: "diger_gelir", amount: 20 }, { key: "diger_gelir", total: 5 }]))).toEqual({ diger_gelir: 25 });
    expect(Object.fromEntries(categoryAmounts('{"x_noter": 7}'))).toEqual({ x_noter: 7 });
    expect(categoryAmounts("bozuk").size).toBe(0);
  });

  it("elle girilen gelir sayılır; komisyon ve kira/aidat tahsilatı İKİ KEZ sayılmaz", () => {
    const [m] = pnlCashMonths([
      {
        month: "2026-09-01",
        income: 180000,
        expense: 30000,
        income_by_category: { komisyon: 150000, kira_tahsilat: 20000, aidat_tahsilat: 1000, hizmet_bedeli: 6000, diger_gelir: 3000 },
        expense_by_category: { kira: 25000, maas: 5000 },
      },
    ]);
    expect(m!.key).toBe("2026-09");
    expect(m!.manualIncome).toBe(9000);
    expect(m!.manualIncomeByCategory).toEqual({ hizmet_bedeli: 6000, diger_gelir: 3000 });
  });

  it("ek gider = finance_pnl gideri − expenses (negatif olmaz); RPC yoksa ek sıfır", () => {
    expect(pnlExtraExpense(30000, 25000)).toBe(5000);
    expect(pnlExtraExpense(20000, 25000)).toBe(0);
    const keys = ["2026-08", "2026-09"];
    const cash = pnlCashMonths([{ month: "2026-09-01", expense: 30000, income_by_category: { hizmet_bedeli: 6000 } }]);
    const expenses = [
      { date: "2026-09-03", amount: 20000 },
      { date: "2026-09-20", amount: 5000 },
      { date: "2026-08-10", amount: 999 },
    ];
    const adj = cashPnlAdjustments(keys, cash, expenses);
    expect(adj.get("2026-09")).toEqual({ manualIncome: 6000, extraExpense: 5000 });
    expect(adj.get("2026-08")).toEqual({ manualIncome: 0, extraExpense: 0 });
    expect(cashPnlAdjustments(keys, null, expenses).get("2026-09")).toEqual({ manualIncome: 0, extraExpense: 0 });
  });

  it("K/Z v3: komisyon payı gider satırı (danisman_hakedis) ek gidere girmez (paylar commission_splits'ten düşülür)", () => {
    const [m] = pnlCashMonths([
      { month: "2026-03-01", income: 106000, expense: 72750, income_by_category: { komisyon: 100000, hizmet_bedeli: 6000 },
        expense_by_category: { danisman_hakedis: 60000, kira: 12000, kirtasiye: 750 } },
    ]);
    expect(m!.expense).toBe(12750);
    expect(m!.manualIncome).toBe(6000);
    expect(m!.expenseByCategory.danisman_hakedis).toBe(60000);
    expect(cashPnlAdjustments(["2026-03"], [m!], [{ date: "2026-03-12", amount: 750 }]).get("2026-03")).toEqual({ manualIncome: 6000, extraExpense: 12000 });
  });

  it("yönetim ücreti (kira_yonetimi) elle gelire eklenmez; mülk sahibine yansıtılan gider farka katılmaz", () => {
    const cash = pnlCashMonths([
      { month: "2026-09-01", expense: 20000, income_by_category: { komisyon: 50000, kira_yonetimi: 1500, hizmet_bedeli: 2000 } },
    ]);
    expect(cash[0]!.manualIncome).toBe(2000);
    const adj = cashPnlAdjustments(["2026-09"], cash, [
      { date: "2026-09-03", amount: 18000 },
      { date: "2026-09-04", amount: 7000, passThrough: true },
    ]);
    expect(adj.get("2026-09")).toEqual({ manualIncome: 2000, extraExpense: 2000 });
  });

  it("kategori kırılımları aylar boyunca toplanır", () => {
    expect(sumCategoryRecords([{ a: 1, b: 5 }, { a: 2 }, { c: 0 }])).toEqual([
      { category: "b", total: 5 },
      { category: "a", total: 3 },
    ]);
  });
});

describe("stopajlı kira ve KDV dökümü", () => {
  it("brüt, stopaj ve net ayrı hesaplanır", () => {
    expect(rentWithholdingBreakdown(50000, 20)).toEqual({ gross: 50000, withheld: 10000, net: 40000 });
    expect(rentWithholdingBreakdown(33333.33, 20)).toEqual({ gross: 33333.33, withheld: 6666.67, net: 26666.66 });
    expect(rentWithholdingBreakdown(1000, 0)).toEqual({ gross: 1000, withheld: 0, net: 1000 });
    expect(rentWithholdingBreakdown(-5, 20)).toEqual({ gross: 0, withheld: 0, net: 0 });
  });

  it("KDV dahil / hariç ayrıştırma", () => {
    expect(vatBreakdown(1200, 20, true)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(vatBreakdown(1000, 20, false)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(vatBreakdown(500, 0, true)).toEqual({ net: 500, vat: 0, gross: 500 });
  });

  it("oran girdisi: boş null, geçersiz undefined", () => {
    expect(parseRatePct("")).toBeNull();
    expect(parseRatePct("%20")).toBe(20);
    expect(parseRatePct("10,5")).toBe(10.5);
    expect(parseRatePct("150")).toBeUndefined();
    expect(parseRatePct("abc")).toBeUndefined();
  });
});

describe("ofis kategorisi anahtarı", () => {
  it("Türkçe katlanır ve x_ öneki alır", () => {
    expect(customCategoryKey("Noter Masrafı")).toBe("x_noter_masrafi");
    expect(customCategoryKey("  Çağrı / Şube  Gideri ")).toBe("x_cagri_sube_gideri");
    expect(customCategoryKey("!!!")).toBe("");
  });
});
