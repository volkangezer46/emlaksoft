import { describe, expect, it } from "vitest";
import { checkTransfer, computeBalance, overdraftWarning } from "./balance";
import { canHandleSalary, expenseCategoryFor, categoriesFor } from "./categories";
import { parseAccountInput, parseEntryInput } from "./input";

const ACC = "11111111-1111-4111-8111-111111111111";

describe("bakiye", () => {
  it("açılış + giriş - çıkış, iptaller hariç, kuruş sapması yok", () => {
    const r = computeBalance(1000.1, [
      { direction: "in", amount: 0.2 },
      { direction: "in", amount: 0.1 },
      { direction: "out", amount: 50.05 },
      { direction: "out", amount: 999, voided: true },
    ]);
    expect(r.balance).toBe(950.35);
    expect(r.count).toBe(3);
  });
  it("transfer kuralları", () => {
    expect(checkTransfer({ fromId: "a", toId: "a", fromCurrency: "TRY", toCurrency: "TRY", amount: 5 }).ok).toBe(false);
    expect(checkTransfer({ fromId: "a", toId: "b", fromCurrency: "TRY", toCurrency: "USD", amount: 5 }).ok).toBe(false);
    expect(checkTransfer({ fromId: "a", toId: "b", fromCurrency: "TRY", toCurrency: "TRY", amount: 5 }).ok).toBe(true);
    expect(overdraftWarning(-1)).not.toBeNull();
  });
});

describe("kategori ve girdi", () => {
  it("maaş gider kaydına dönüşmez; yalnız owner/gm yönetir", () => {
    expect(expenseCategoryFor("maas")).toBeNull();
    expect(expenseCategoryFor("portal")).toBe("reklam");
    expect(canHandleSalary("owner")).toBe(true);
    expect(canHandleSalary("accounting")).toBe(false);
    expect(categoriesFor("in").every((c) => c.direction === "in")).toBe(true);
  });
  it("3 zorunlu alanla geçerli; tarih bugün varsayılır; gelecek tarih ve bozuk tutar reddedilir", () => {
    const ok = parseEntryInput({ accountId: ACC, amount: "1.250,50", category: "reklam" }, "out", "2026-10-10");
    expect(ok.ok && ok.value.amount).toBe(1250.5);
    expect(ok.ok && ok.value.date).toBe("2026-10-10");
    expect(ok.ok && ok.value.title).toBe("Reklam");
    expect(parseEntryInput({ accountId: ACC, amount: "-5", category: "reklam" }, "out", "2026-10-10").ok).toBe(false);
    expect(parseEntryInput({ accountId: ACC, amount: "5", category: "reklam", date: "2026-10-11" }, "out", "2026-10-10").ok).toBe(false);
    expect(parseEntryInput({ accountId: ACC, amount: "5", category: "komisyon" }, "out", "2026-10-10").ok).toBe(false);
  });
  it("hesap girdisi: kart borcu eksi bakiye, IBAN son 4 doğrulanır", () => {
    const card = parseAccountInput({ kind: "card", name: "Kart", openingBalance: "500", openingIsDebt: "1" }, "2026-10-10");
    expect(card.ok && card.value.openingBalance).toBe(-500);
    expect(parseAccountInput({ kind: "bank", name: "B", ibanLast4: "12a4" }, "2026-10-10").ok).toBe(false);
  });
});
