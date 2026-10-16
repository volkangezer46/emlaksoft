import { describe, expect, it } from "vitest";
import { formatTry, formatTryAmount, formatTryDecimal, formatTryKurus } from "./format";
import { formatAccountMoney } from "./finance/cash/money";

describe("TL tutarı tek biçim: ₺ önekli", () => {
  it("finans ve diğer ekranlar aynı biçimi üretir", () => {
    expect(formatTry(1_913_395)).toBe("₺1.913.395");
    expect(formatTryAmount(1_913_395)).toBe("₺1.913.395");
    expect(formatTryDecimal(1_913_395)).toBe("₺1.913.395");
    expect(formatAccountMoney(1_913_395, "TRY")).toBe("₺1.913.395");
  });
  it("kuruş ve eksi tutarlar", () => {
    expect(formatTryDecimal(1234.5)).toBe("₺1.234,5");
    expect(formatTryKurus(1494)).toBe("₺1.494,00");
    expect(formatAccountMoney(-250.75, "TRY")).toBe("-₺250,75");
    expect(formatAccountMoney(2650.6, "TRY")).toBe("₺2.650,60");
    expect(formatAccountMoney(-13445, "TRY")).toBe("-₺13.445");
    expect(formatTryAmount(-0.2)).toBe("₺0");
    expect(formatTryAmount(Number.NaN)).toBe("—");
  });
});
