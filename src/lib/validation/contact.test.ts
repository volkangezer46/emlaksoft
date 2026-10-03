import { describe, expect, it } from "vitest";
import {
  emailSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  phoneSchema,
  phoneSchemaFor,
} from "./contact";

describe("phoneSchema", () => {
  it("saklama biçimine çevirir", () => {
    expect(phoneSchema.parse("0532 123 45 67")).toBe("05321234567");
    expect(phoneSchema.parse(" +90 532 123 45 67 ")).toBe("05321234567");
    expect(phoneSchema.parse("+49 151 23456789")).toBe("+4915123456789");
  });
  it("boş ve geçersizi reddeder", () => {
    expect(phoneSchema.safeParse("").success).toBe(false);
    expect(phoneSchema.safeParse("   ").success).toBe(false);
    expect(phoneSchema.safeParse("abc").success).toBe(false);
    expect(phoneSchema.safeParse("0532").success).toBe(false);
    expect(phoneSchema.safeParse(undefined).success).toBe(false);
    expect(phoneSchema.safeParse(null).success).toBe(false);
  });
  it("hata mesajı Türkçe ve dolu", () => {
    const r = phoneSchema.safeParse("0532");
    expect(r.success ? "" : r.error.issues[0].message).toMatch(/numara/i);
  });
  it("varsayılan ülke", () => {
    expect(phoneSchemaFor("DE").parse("0151 23456789")).toBe("+4915123456789");
  });
});

describe("optionalPhoneSchema", () => {
  it("boş -> null", () => {
    expect(optionalPhoneSchema.parse("")).toBeNull();
    expect(optionalPhoneSchema.parse("  ")).toBeNull();
    expect(optionalPhoneSchema.parse(null)).toBeNull();
    expect(optionalPhoneSchema.parse(undefined)).toBeNull();
  });
  it("dolu geçerli -> stored, geçersiz -> hata", () => {
    expect(optionalPhoneSchema.parse("5321234567")).toBe("05321234567");
    expect(optionalPhoneSchema.safeParse("12").success).toBe(false);
  });
});

describe("emailSchema", () => {
  it("normalize eder", () => {
    expect(emailSchema.parse("  Ali@Ornek.COM ")).toBe("ali@ornek.com");
  });
  it("geçersiz/boşu reddeder", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("ali@").success).toBe(false);
    expect(emailSchema.safeParse(undefined).success).toBe(false);
    const r = emailSchema.safeParse("x");
    expect(r.success ? "" : r.error.issues[0].message).toBe("Geçerli bir e-posta adresi girin");
  });
});

describe("optionalEmailSchema", () => {
  it("boş -> null", () => {
    expect(optionalEmailSchema.parse("")).toBeNull();
    expect(optionalEmailSchema.parse(null)).toBeNull();
    expect(optionalEmailSchema.parse(undefined)).toBeNull();
  });
  it("dolu", () => {
    expect(optionalEmailSchema.parse(" A@B.co ")).toBe("a@b.co");
    expect(optionalEmailSchema.safeParse("a@b").success).toBe(false);
  });
});
