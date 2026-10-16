import { describe, expect, it } from "vitest";
import { TAX_NUMBER_ERROR, normalizeTaxNumber } from "./tax-number";

describe("normalizeTaxNumber", () => {
  it("boş değer serbest (null)", () => {
    expect(normalizeTaxNumber("")).toEqual({ ok: true, value: null });
    expect(normalizeTaxNumber(null)).toEqual({ ok: true, value: null });
    expect(normalizeTaxNumber("  ")).toEqual({ ok: true, value: null });
  });
  it("10 hane VKN ve 11 hane TCKN; boşluk/nokta/tire atılır", () => {
    expect(normalizeTaxNumber("123 456 7890")).toEqual({ ok: true, value: "1234567890" });
    expect(normalizeTaxNumber("123.456.789-01")).toEqual({ ok: true, value: "12345678901" });
  });
  it("harf, eksik ya da fazla hane reddedilir", () => {
    for (const bad of ["Kadıköy VD", "123456789", "123456789012", "12345abcde"]) {
      expect(normalizeTaxNumber(bad)).toEqual({ ok: false, error: TAX_NUMBER_ERROR });
    }
  });
});
