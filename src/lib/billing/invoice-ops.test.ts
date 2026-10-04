import { describe, expect, it } from "vitest";
import { parseMoneyTry, validateRefundAmount } from "./invoice-ops";

describe("parseMoneyTry", () => {
  it("TR ve nokta biçimlerini okur", () => {
    expect(parseMoneyTry("1.234,56")).toBe(1234.56);
    expect(parseMoneyTry("2490")).toBe(2490);
    expect(parseMoneyTry("2490.5 TL")).toBe(2490.5);
  });
  it("negatif, sıfır, harf, 3 ondalık ve aşırı değeri reddeder", () => {
    for (const bad of ["-5", "0", "abc", "1,234", "99999999", "", "1e5"]) expect(parseMoneyTry(bad), bad).toBeNull();
  });
});

describe("validateRefundAmount", () => {
  it("boş = tam tutar, fazlası reddedilir", () => {
    expect(validateRefundAmount("", 2988)).toEqual({ value: 2988 });
    expect(validateRefundAmount("500", 2988)).toEqual({ value: 500 });
    expect("error" in validateRefundAmount("3000", 2988)).toBe(true);
    expect("error" in validateRefundAmount("-1", 2988)).toBe(true);
  });
});
