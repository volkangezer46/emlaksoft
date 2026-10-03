import { describe, expect, it } from "vitest";
import { isValidEmail, isValidOptionalEmail, normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("kırpar ve küçük harfe çevirir", () => {
    expect(normalizeEmail("  Ali.Veli@Ornek.COM ")).toBe("ali.veli@ornek.com");
    expect(normalizeEmail("INFO@ISTANBUL.COM")).toBe("info@istanbul.com");
  });
  it("null/undefined -> boş", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("isValidEmail", () => {
  it("geçerliler", () => {
    for (const e of [
      "a@b.co",
      "ali.veli@ornek.com.tr",
      "ali+emlak@gmail.com",
      "ali_veli-1@mail.ornek.org",
      "  Ali@Ornek.com  ",
      "x@müşteri.com.tr", // IDN alan adı
      "x@xn--mteri-5wa.com",
      "o'brien@ornek.com",
    ]) {
      expect(isValidEmail(e), e).toBe(true);
    }
  });
  it("geçersizler", () => {
    for (const e of [
      "",
      " ",
      "ali",
      "ali@",
      "@ornek.com",
      "ali@ornek",
      "ali@@ornek.com",
      "a@b@c.com",
      "ali veli@ornek.com",
      "ali@ornek .com",
      "ali..veli@ornek.com",
      ".ali@ornek.com",
      "ali.@ornek.com",
      "ali@-ornek.com",
      "ali@ornek-.com",
      "ali@ornek..com",
      "ali@ornek.c",
      "ali@ornek.c0m",
      "çağrı@ornek.com", // Unicode yerel kısım desteklenmez
      "ali@ornek.com.",
      "<ali@ornek.com>",
    ]) {
      expect(isValidEmail(e), e).toBe(false);
    }
  });
  it("uzunluk sınırları", () => {
    expect(isValidEmail(`${"a".repeat(64)}@ornek.com`)).toBe(true);
    expect(isValidEmail(`${"a".repeat(65)}@ornek.com`)).toBe(false);
    expect(isValidEmail(`a@${"b".repeat(63)}.com`)).toBe(true);
    expect(isValidEmail(`a@${"b".repeat(64)}.com`)).toBe(false);
    expect(isValidEmail(`a@${`${"b".repeat(60)}.`.repeat(5)}com`)).toBe(false); // >254
  });
  it("isValidOptionalEmail", () => {
    expect(isValidOptionalEmail("")).toBe(true);
    expect(isValidOptionalEmail(null)).toBe(true);
    expect(isValidOptionalEmail("x")).toBe(false);
    expect(isValidOptionalEmail("a@b.co")).toBe(true);
  });
});
