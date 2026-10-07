import { describe, expect, it } from "vitest";
import { EXPENSE_INPUT_LIMITS, isExpenseId, parseExpenseForm } from "@/lib/expense-input";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    title: "Portal reklamı",
    amount: "1250.50",
    category: "reklam",
    expense_date: "2026-08-13",
    notes: "Ağustos kampanyası",
    ...overrides,
  })) data.set(key, value);
  return data;
}

describe("expense input", () => {
  it("normalizes a valid expense without losing cents", () => {
    expect(parseExpenseForm(form())).toEqual({
      ok: true,
      value: {
        title: "Portal reklamı",
        amount: 1250.5,
        category: "reklam",
        expenseDate: "2026-08-13",
        notes: "Ağustos kampanyası",
        propertyId: null,
        receiptUrl: null,
      },
    });
  });

  it("fiş bağlantısı yalnız https kabul eder ve normalize eder", () => {
    const ok = parseExpenseForm(form({ receipt_url: "https://earsiv.example.com/fatura/1" }));
    expect(ok.ok && ok.value.receiptUrl).toBe("https://earsiv.example.com/fatura/1");
    expect(parseExpenseForm(form({ receipt_url: "http://x.example.com" })).ok).toBe(false);
    expect(parseExpenseForm(form({ receipt_url: "javascript:alert(1)" })).ok).toBe(false);
    expect(parseExpenseForm(form({ receipt_url: "https://u:p@x.example.com" })).ok).toBe(false);
  });

  it.each(["1abc", "-1", "0", "1.234", "NaN", "Infinity"])(
    "rejects malformed or out-of-range amount %s",
    (amount) => expect(parseExpenseForm(form({ amount })).ok).toBe(false),
  );

  it("rejects impossible calendar dates", () => {
    expect(parseExpenseForm(form({ expense_date: "2026-02-30" }))).toEqual({
      ok: false,
      error: "Geçerli bir gider tarihi girin.",
    });
  });

  it("bounds text and category fields", () => {
    expect(parseExpenseForm(form({ title: "x".repeat(EXPENSE_INPUT_LIMITS.title + 1) })).ok).toBe(false);
    expect(parseExpenseForm(form({ notes: "x".repeat(EXPENSE_INPUT_LIMITS.notes + 1) })).ok).toBe(false);
    expect(parseExpenseForm(form({ category: "../../other" })).ok).toBe(false);
  });

  it("accepts only canonical UUID record identifiers", () => {
    expect(isExpenseId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isExpenseId("not-an-id")).toBe(false);
    expect(parseExpenseForm(form({ property_id: "not-an-id" })).ok).toBe(false);
  });
});
