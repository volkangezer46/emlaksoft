import { describe, expect, it } from "vitest";
import { CLOSED_PROPERTY_STATUSES, wonDealPropertyStatus } from "../deal-outcome";

/**
 * P0 REGRESYON KİLİDİ: Kira anlaşması kazanılınca portföy "Satıldı" olmamalı.
 * Bu hata kiralık portföyü kalıcı olarak eşleştirmeden ve vitrinden düşürüyordu.
 */
describe("wonDealPropertyStatus", () => {
  it("kira anlaşmasında portföy 'rented' (Kiralandı) olur — ASLA 'sold'", () => {
    expect(wonDealPropertyStatus("rent")).toBe("rented");
    expect(wonDealPropertyStatus("rent")).not.toBe("sold");
  });

  it("satış anlaşmasında portföy 'sold' olur", () => {
    expect(wonDealPropertyStatus("sale")).toBe("sold");
  });

  it("deal_type bilinmiyorsa satış varsayılır (deals tablosunun varsayılanı 'sale')", () => {
    expect(wonDealPropertyStatus(null)).toBe("sold");
    expect(wonDealPropertyStatus(undefined)).toBe("sold");
    expect(wonDealPropertyStatus("")).toBe("sold");
    expect(wonDealPropertyStatus("bilinmeyen")).toBe("sold");
  });

  it("dönen değerler property_status sözlüğünde tanımlı olanlarla sınırlı", () => {
    for (const t of ["sale", "rent", "", null, undefined, "xyz"]) {
      expect(CLOSED_PROPERTY_STATUSES).toContain(wonDealPropertyStatus(t as string | null));
    }
  });
});
