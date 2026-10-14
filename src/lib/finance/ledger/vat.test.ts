import { describe, expect, it } from "vitest";
import { entryAmounts, LEDGER_VAT_RATES, RENT_WITHHOLDING_RATE, splitVat, withholding } from "./vat";

describe("splitVat", () => {
  it("KDV dahil: brüt sabit, net ve KDV ayrışır (%1 / %10 / %20)", () => {
    expect(splitVat(1200, 20, true)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(splitVat(1100, 10, true)).toEqual({ net: 1000, vat: 100, gross: 1100 });
    expect(splitVat(1010, 1, true)).toEqual({ net: 1000, vat: 10, gross: 1010 });
  });

  it("KDV hariç: net sabit, KDV eklenir", () => {
    expect(splitVat(1000, 20, false)).toEqual({ net: 1000, vat: 200, gross: 1200 });
    expect(splitVat(999.99, 10, false)).toEqual({ net: 999.99, vat: 100, gross: 1099.99 });
    expect(splitVat(4500, 1, false)).toEqual({ net: 4500, vat: 45, gross: 4545 });
  });

  it("kuruş yuvarlaması yarım yukarı ve her zaman net + KDV = brüt", () => {
    // 0,03 × 100 / 120 = 0,025 → 0,03 (yarım yukarı); KDV 0
    expect(splitVat(0.03, 20, true)).toEqual({ net: 0.03, vat: 0, gross: 0.03 });
    expect(splitVat(0.05, 10, false)).toEqual({ net: 0.05, vat: 0.01, gross: 0.06 });
    for (const rate of LEDGER_VAT_RATES) {
      for (const amount of [0.01, 1, 9.99, 117.35, 4321.07, 100000]) {
        for (const included of [true, false]) {
          const s = splitVat(amount, rate, included);
          expect(Math.round((s.net + s.vat) * 100)).toBe(Math.round(s.gross * 100));
        }
      }
    }
  });

  it("KDV'siz (%0) ve geçersiz girdi", () => {
    expect(splitVat(250, 0, true)).toEqual({ net: 250, vat: 0, gross: 250 });
    expect(splitVat(Number.NaN, 20, true)).toEqual({ net: 0, vat: 0, gross: 0 });
    expect(splitVat(100, 120, true)).toEqual({ net: 0, vat: 0, gross: 0 });
  });
});

describe("withholding", () => {
  it("kira stopajı %20: 10.000 brüt kiradan 2.000 kesilir, 8.000 ödenir", () => {
    expect(withholding(10000, RENT_WITHHOLDING_RATE)).toEqual({ withheld: 2000, net: 8000 });
    expect(withholding(333.33, 20)).toEqual({ withheld: 66.67, net: 266.66 });
  });
});

describe("entryAmounts", () => {
  it("KDV oranı yoksa KDV bilinmiyor (null) ve nakit = tutar", () => {
    expect(entryAmounts(4500, null, true, null)).toEqual({ net: 4500, vat: null, gross: 4500, withheld: null, cash: 4500 });
  });

  it("KDV hariç belge + stopaj: nakit = brüt − stopaj (stopaj net üzerinden)", () => {
    expect(entryAmounts(10000, 20, false, 20)).toEqual({ net: 10000, vat: 2000, gross: 12000, withheld: 2000, cash: 10000 });
  });

  it("KDV dahil belge", () => {
    expect(entryAmounts(1200, 20, true, null)).toEqual({ net: 1000, vat: 200, gross: 1200, withheld: null, cash: 1200 });
  });
});
