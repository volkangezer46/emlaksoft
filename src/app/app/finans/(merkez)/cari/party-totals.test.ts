import { describe, expect, it } from "vitest";
import { sumPartyBalances } from "./party-totals";

describe("alacak / borç tek tanım (C24)", () => {
  it("pozitif net bakiyeler Alacağımız, negatifler Borcumuz; kuruş hassas", () => {
    const t = sumPartyBalances([
      { balance: 100.1, overdue_amount: 0 },
      { balance: 0.2, overdue_amount: 50 },
      { balance: -30.15, overdue_amount: 0 },
      { balance: 0, overdue_amount: 0 },
    ]);
    expect(t.receivable).toBe(100.3);
    expect(t.payable).toBe(30.15);
    expect(t.overdue).toBe(50);
    expect(t.overdueParties).toBe(1);
  });

  it("boş liste sıfır", () => {
    expect(sumPartyBalances([])).toEqual({ receivable: 0, payable: 0, overdue: 0, overdueParties: 0 });
  });
});
