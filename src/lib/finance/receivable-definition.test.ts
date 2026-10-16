import { describe, expect, it } from "vitest";
import { formatAccountMoney, formatKpiMoney } from "./cash/money";
import { PARTY_NET_RECEIVABLE_LABEL, RECEIVABLE_LABEL } from "./receivable-definition";

describe("kuruş politikası", () => {
  it("kart/KPI tam TL, defter kuruşlu", () => {
    expect(formatKpiMoney(58351.11)).toBe("₺58.351");
    expect(formatKpiMoney(592050.6)).toBe("₺592.051");
    expect(formatKpiMoney(-0.4)).toBe("₺0");
    expect(formatKpiMoney(Number.NaN)).toBe("₺0");
    expect(formatAccountMoney(58351.11, "TRY")).toBe("₺58.351,11");
  });
});

describe("alacak tek tanım", () => {
  it("genel tanım ile cari net ölçüsü ayrı adlı", () => {
    expect(RECEIVABLE_LABEL).toBe("Alacağımız");
    expect(RECEIVABLE_LABEL).not.toBe(PARTY_NET_RECEIVABLE_LABEL);
  });
});
