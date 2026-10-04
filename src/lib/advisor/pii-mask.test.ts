import { describe, expect, it } from "vitest";
import { changedFieldNames, ibanError, isValidIban, last4, maskIban, maskTc, normalizeIban, normalizeTc, tcError } from "./pii-mask";

describe("TC kimlik", () => {
  it("geçerli numarayı kabul, geçersizi reddeder; boş serbest", () => {
    expect(tcError("10000000146")).toBeNull();
    expect(tcError("100 000 001 46")).toBeNull();
    expect(tcError("10000000147")).not.toBeNull();
    expect(tcError("1234567890")).not.toBeNull();
    expect(tcError("")).toBeNull();
    expect(normalizeTc(" 100.000.001-46 ")).toBe("10000000146");
  });
});

describe("IBAN", () => {
  const OK = "TR33 0006 1005 1978 6457 8413 26";
  it("mod 97 ve TR uzunluğunu doğrular", () => {
    expect(isValidIban(OK)).toBe(true);
    expect(isValidIban("tr330006100519786457841326")).toBe(true);
    expect(isValidIban("TR330006100519786457841327")).toBe(false);
    expect(isValidIban("TR3300061005197864578413")).toBe(false);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
    expect(ibanError("")).toBeNull();
    expect(ibanError("abc")).not.toBeNull();
    expect(normalizeIban(OK)).toBe("TR330006100519786457841326");
  });
});

describe("maskeleme", () => {
  it("yalnız son 4 hane görünür", () => {
    expect(last4("10000000146")).toBe("0146");
    expect(maskTc("0146")).toBe("•••••••0146");
    expect(maskIban("1326")).toBe("•••• •••• •••• 1326");
    expect(maskTc(null)).toBeNull();
    expect(maskTc("abcd")).toBeNull();
    expect(maskIban("")).toBeNull();
    expect(maskTc("0146")).not.toContain("10000000");
  });
  it("denetim özeti yalnız alan adı taşır", () => {
    const names = changedFieldNames({ national_id: "10000000146", bank_name: "X", skipped: undefined });
    expect(names).toEqual(["bank_name", "national_id"]);
    expect(JSON.stringify(names)).not.toContain("10000000146");
  });
});
