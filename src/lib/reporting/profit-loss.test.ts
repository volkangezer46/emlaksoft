import { describe, expect, it } from "vitest";
import { buildProfitLoss, computeOfficePnl, lastMonthKeys } from "./profit-loss";

describe("ofis kâr/zarar", () => {
  it("son 12 ay anahtarları eskiden yeniye", () => {
    const k = lastMonthKeys("2026-02", 3);
    expect(k).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("net = matrah (gross_amount, KDV hariç) − ofis dışı paylar − gider; KDV yalnız bilgi; iptal sayılmaz; paylaşımsız komisyon uyarılır", () => {
    const pl = buildProfitLoss(
      ["2026-09", "2026-10"],
      [
        // gross_amount KDV HARİÇ matrahtır (kapanış RPC'si v_net'i yazar); KDV %20 ayrıca vat_amount'ta.
        { id: "c1", createdAt: "2026-09-10T10:00:00Z", gross: 120_000, vat: 24_000, status: "paid" },
        { id: "c2", createdAt: "2026-10-02T10:00:00Z", gross: 60_000, vat: 12_000, status: "calculated" },
        { id: "c3", createdAt: "2026-10-03T10:00:00Z", gross: 999_999, vat: 0, status: "cancelled" },
      ],
      [
        { commissionId: "c1", kind: "advisor", amount: 50_000 },
        { commissionId: "c1", kind: "office", amount: 70_000 },
      ],
      [{ date: "2026-09-15", amount: 8_000 }, { date: "2026-08-01", amount: 1 }],
    );
    expect(pl.months[0]).toMatchObject({ key: "2026-09", revenue: 120_000, vat: 24_000, shares: 50_000, expenses: 8_000, net: 62_000 });
    expect(pl.months[1]).toMatchObject({ key: "2026-10", net: 60_000, commissions: 1 });
    expect(pl.unsplitCount).toBe(1);
    expect(pl.totals.net).toBe(122_000);
    expect(pl.totals.vat).toBe(36_000);
  });

  it("B103: matrah 315.000 + KDV 63.000 olan ayda gelir 315.000'dir (KDV ikinci kez düşülmez)", () => {
    const pl = buildProfitLoss(["2026-08"], [{ id: "a", createdAt: "2026-08-12T09:00:00Z", gross: 315_000, vat: 63_000, status: "paid" }], [], []);
    expect(pl.months[0]!.revenue).toBe(315_000);
    expect(pl.months[0]!.net).toBe(315_000);
  });
});

describe("computeOfficePnl (TEK kâr/zarar hesabı)", () => {
  it("defter eki: elle gelir eklenir, expenses dışı çıkış gidere girer; ay net'i finance_pnl (gelir − gider) ile aynı", () => {
    const keys = ["2026-09"];
    const commissions = [{ id: "c1", createdAt: "2026-09-10T10:00:00Z", gross: 120_000, vat: 24_000, status: "paid" }];
    const splits = [{ commissionId: "c1", kind: "advisor", amount: 50_000 }];
    const expenses = [{ date: "2026-09-15", amount: 8_000 }];
    const fees = [{ date: "2026-09-20", amount: 1_500 }];
    // finance_pnl (20261016060100): gelir = (matrah − dış pay) + yönetim ücreti + elle gelir; gider = expenses + deftere bağlı olmayan çıkış (maaş 4.000).
    const income = 120_000 - 50_000 + 1_500 + 3_000;
    const expense = 8_000 + 4_000;
    const cash = [{ key: "2026-09", manualIncome: 3_000, manualIncomeByCategory: { hizmet_bedeli: 3_000 }, income, expense, incomeByCategory: {}, expenseByCategory: {} }];
    const pl = computeOfficePnl(keys, { commissions, splits, expenses, fees, cash });
    expect(pl.months[0]).toMatchObject({ other: 3_000, expenses: 12_000, net: income - expense });
    expect(pl.totals.net).toBe(income - expense);
    expect(pl.cashLinked).toBe(true);
    // Defter eki yoksa taban hesap aynen sürer.
    const bare = computeOfficePnl(keys, { commissions, splits, expenses, fees, cash: null });
    expect(bare.months[0]).toMatchObject({ other: 0, expenses: 8_000, net: 120_000 - 50_000 + 1_500 - 8_000 });
    expect(bare.cashLinked).toBe(false);
  });
});
