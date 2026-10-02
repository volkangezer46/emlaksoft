import { describe, expect, it } from "vitest";
import { normalizeBuyerIdentityNumber, validateCheckoutBuyer } from "./buyer";

describe("checkout buyer validation", () => {
  it("accepts real required fields and produces the provider contract without fallbacks", () => {
    expect(validateCheckoutBuyer({
      id: "buyer-111",
      fullName: "Ayşe Yılmaz",
      email: "AYSE@example.com",
      phone: "0532 123 45 67",
      identityNumber: "10000000146",
      address: "Bağdat Caddesi No: 42 Kadıköy",
      city: "İstanbul",
      ip: "203.0.113.9",
    })).toMatchObject({
      buyer: {
        id: "buyer-111",
        name: "Ayşe",
        surname: "Yılmaz",
        email: "ayse@example.com",
        gsmNumber: "+905321234567",
        identityNumber: "10000000146",
        registrationAddress: "Bağdat Caddesi No: 42 Kadıköy",
        city: "İstanbul",
        country: "Turkey",
      },
    });
  });

  it("rejects placeholders and malformed citizen identity checksums", () => {
    expect(normalizeBuyerIdentityNumber("11111111111")).toBeNull();
    expect(normalizeBuyerIdentityNumber("10000000145")).toBeNull();
    expect(normalizeBuyerIdentityNumber("1234567890")).toBe("1234567890");
  });

  it.each([
    ["fullName", "Ayşe"],
    ["email", "invalid"],
    ["phone", "555"],
    ["identityNumber", "11111111111"],
    ["address", "kısa"],
    ["city", ""],
  ] as const)("fails closed when %s is incomplete", (field, value) => {
    const input = {
      id: "buyer-1",
      fullName: "Ayşe Yılmaz",
      email: "ayse@example.com",
      phone: "05321234567",
      identityNumber: "10000000146",
      address: "Bağdat Caddesi No: 42",
      city: "İstanbul",
      ip: "203.0.113.9",
      [field]: value,
    };
    expect(() => validateCheckoutBuyer(input)).toThrow();
  });
});
