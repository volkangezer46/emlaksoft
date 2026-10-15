import { describe, expect, it } from "vitest";
import { ledgerExpenseAmount, mergeLedgerExpenses, mergePortalExpenses, sumLedgerExpensesByCategory, type LedgerExpenseEntry } from "./ledger-expenses";
import { cashPnlAdjustments } from "./expense-budget";
import { computeAdvisorProfitability } from "./advisor-profitability";

const entry = (o: Partial<LedgerExpenseEntry>): LedgerExpenseEntry => ({
  id: o.id ?? "e1", entry_date: "2026-09-10", direction: "out", kind: "expense", amount: 1000, category: "ofis", ...o,
});

describe("defter gider okuyucusu (WP5)", () => {
  it("gider matrahı = tutar + stopaj − KDV; emanet ve transfer gider değildir; kilitli dönem aynası düşer", () => {
    expect(ledgerExpenseAmount(entry({ amount: 1200, vat_amount: 200 }))).toBe(1000);
    expect(ledgerExpenseAmount(entry({ amount: 800, withholding_amount: 200 }))).toBe(1000);
    expect(ledgerExpenseAmount(entry({ category: "depozito" }))).toBeNull();
    expect(ledgerExpenseAmount(entry({ category: "mulk_sahibi_odeme" }))).toBeNull();
    expect(ledgerExpenseAmount(entry({ category: "transfer", kind: "transfer" }))).toBeNull();
    expect(ledgerExpenseAmount(entry({ source_type: "owner_payout" }))).toBeNull();
    expect(ledgerExpenseAmount(entry({ kind: "income", direction: "in", category: "komisyon" }))).toBeNull();
    // Ayna: giderin tersi (giriş, adjust) negatif; gelirin aynası (çıkış, adjust) gider DEĞİL.
    expect(ledgerExpenseAmount(entry({ kind: "adjust", direction: "in", reversal_of: "e0", amount: 500 }))).toBe(-500);
    expect(ledgerExpenseAmount(entry({ kind: "adjust", direction: "out", reversal_of: "e0", category: "komisyon" }))).toBeNull();
    expect(ledgerExpenseAmount(entry({ kind: "adjust", direction: "in" }))).toBeNull();
  });

  it("eski gider satırı canlı defter bağı varsa ikinci kez sayılmaz; bağsız geçmiş satır sayılır", () => {
    const rows = mergeLedgerExpenses(
      [entry({ id: "a", amount: 1000, expense_id: "x1", category: "kira", property_id: "p1", advisorId: "u1" }), entry({ id: "b", amount: 300, category: "maas" })],
      [
        { id: "x1", expense_date: "2026-09-10", amount: 1000, category: "ofis" },
        { id: "x2", expense_date: "2026-08-05", amount: 250, category: "reklam", advisorId: "u2" },
      ],
    );
    expect(rows.map((r) => [r.source, r.amount, r.expenseCategory, r.advisorId])).toEqual([
      ["ledger", 1000, "ofis", "u1"],
      ["ledger", 300, null, null],
      ["legacy", 250, "reklam", "u2"],
    ]);
    expect(Object.fromEntries(sumLedgerExpensesByCategory(rows))).toEqual({ ofis: 1000, reklam: 250 });
  });

  it("kâr/zarar eki: defter satırlarıyla finance_pnl aynı tabanda (ek gider 0); danışman maliyeti portföy sahibine", () => {
    const rows = mergeLedgerExpenses(
      [entry({ id: "a", amount: 1200, vat_amount: 200, advisorId: "u1" }), entry({ id: "m", kind: "adjust", direction: "in", reversal_of: "a0", amount: 100, advisorId: "u1" })],
      [{ id: "x", expense_date: "2026-09-02", amount: 400, category: "ofis" }],
    );
    const expenseRows = rows.map((r) => ({ date: r.date, amount: r.amount }));
    const adj = cashPnlAdjustments(["2026-09"], [{ key: "2026-09", manualIncome: 0, manualIncomeByCategory: {}, income: 0, expense: 1300, incomeByCategory: {}, expenseByCategory: {} }], expenseRows);
    expect(adj.get("2026-09")).toEqual({ manualIncome: 0, extraExpense: 0 });
    const prof = computeAdvisorProfitability([], [], rows.map((r) => ({ advisorId: r.advisorId, amount: r.amount })), new Map([["u1", "Deniz"]]));
    expect(prof.rows).toEqual([{ advisorId: "u1", name: "Deniz", commissions: 0, gross: 0, retained: 0, directCosts: 900, net: -900, unsplit: 0 }]);
    expect(prof.unattributedExpenses).toBe(400);
  });

  it("portal giderleri: kural hareketi (dönem sıklığıyla) + bağsız eski satır; bağlı eski satır tekrar etmez", () => {
    const out = mergePortalExpenses(
      [{ portalKey: "sahibinden", frequency: "yearly", entry: entry({ id: "r1", amount: 12000, category: "portal", expense_id: "old1", entry_date: "2026-03-01" }) }],
      [
        { id: "old1", portal_key: "sahibinden", amount: 12000, expense_date: "2026-03-01", recurrence: "yearly" },
        { id: "old2", portal_key: "hepsiemlak", amount: 3000, expense_date: "2026-05-01", recurrence: null },
      ],
      new Set(["old1"]),
    );
    expect(out).toEqual([
      { portalKey: "sahibinden", amount: 12000, date: "2026-03-01", recurrence: "yearly" },
      { portalKey: "hepsiemlak", amount: 3000, date: "2026-05-01", recurrence: null },
    ]);
  });
});
