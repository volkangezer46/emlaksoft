import { describe, expect, it } from "vitest";
import { parseRentalUsage, parseWithholdingRate, splitGrossRent } from "./rent-withholding";

describe("rent withholding", () => {
  it("brüt kiradan %20 stopaj ve net (kuruş yuvarlama)", () => {
    expect(splitGrossRent(25_000, 20)).toEqual({ gross: 25_000, withholding: 5_000, net: 20_000 });
    expect(splitGrossRent(10_000.55, 20)).toEqual({ gross: 10_000.55, withholding: 2_000.11, net: 8_000.44 });
    expect(splitGrossRent(10_000, 0)).toEqual({ gross: 10_000, withholding: 0, net: 10_000 });
  });

  it("oran ve kullanım ayrıştırma", () => {
    expect(parseWithholdingRate("")).toBe(0);
    expect(parseWithholdingRate("20")).toBe(20);
    expect(parseWithholdingRate("17,5")).toBe(17.5);
    expect(parseWithholdingRate("51")).toBeNull();
    expect(parseWithholdingRate("abc")).toBeNull();
    expect(parseRentalUsage("isyeri")).toBe("isyeri");
    expect(parseRentalUsage("x")).toBe("konut");
  });
});
