import { describe, expect, it } from "vitest";
import {
  formatPhoneDisplay,
  interpretPhoneEntry,
  isValidOptionalPhone,
  isValidPhone,
  normalizePhone,
  normalizeTurkishPhone,
  parsePhone,
  toE164Phone,
  toTelHref,
  toWhatsAppLink,
  toWhatsAppMsisdn,
} from "./phone";
import { matchPhoneCountry, PHONE_COUNTRIES, getPhoneCountry } from "./phone-countries";

describe("phone-countries", () => {
  it("en az 60 ülke, TR en üstte, iso benzersiz", () => {
    expect(PHONE_COUNTRIES.length).toBeGreaterThanOrEqual(60);
    expect(PHONE_COUNTRIES[0].iso).toBe("TR");
    expect(new Set(PHONE_COUNTRIES.map((c) => c.iso)).size).toBe(PHONE_COUNTRIES.length);
  });
  it("her satır tutarlı", () => {
    for (const c of PHONE_COUNTRIES) {
      expect(c.dial).toMatch(/^[1-9]\d{0,2}$/);
      expect(c.min).toBeGreaterThan(0);
      expect(c.max).toBeGreaterThanOrEqual(c.min);
      expect(c.flag.length).toBeGreaterThan(0);
      expect(c.example.replace(/\D/g, "").length).toBeGreaterThanOrEqual(c.min);
      expect(c.example.replace(/\D/g, "").length).toBeLessThanOrEqual(c.max);
    }
  });
  it("zorunlu ülkeler mevcut", () => {
    for (const iso of ["DE", "NL", "FR", "GB", "US", "CA", "RU", "AZ", "SA", "AE", "QA", "KW", "UA", "IR", "IQ", "SY", "BG", "GR", "RO", "GE", "KZ", "CN", "JP"]) {
      expect(getPhoneCountry(iso), iso).toBeDefined();
    }
  });
  it("arama kodu en uzun eşleşmeyle bulunur", () => {
    expect(matchPhoneCountry("905321234567")?.iso).toBe("TR");
    expect(matchPhoneCountry("4915123456789")?.iso).toBe("DE");
    expect(matchPhoneCountry("994501234567")?.iso).toBe("AZ");
    expect(matchPhoneCountry("12125551234")?.iso).toBe("US");
    expect(matchPhoneCountry("79123456789")?.iso).toBe("RU");
    expect(matchPhoneCountry("77711234567")?.iso).toBe("KZ");
    expect(matchPhoneCountry("999")).toBeUndefined();
  });
});

describe("parsePhone - Türkiye", () => {
  const HEDEF = "05321234567";
  it("tüm yazımlar aynı saklama biçimine iner", () => {
    for (const g of [
      "05321234567",
      "5321234567",
      "0532 123 45 67",
      "(0532) 123-45-67",
      "+90 532 123 45 67",
      "+905321234567",
      "00905321234567",
      "905321234567",
      "+90 (0532) 123 45 67",
      "0532.123.45.67",
    ]) {
      const p = parsePhone(g);
      expect(p.ok, g).toBe(true);
      expect(p.stored, g).toBe(HEDEF);
      expect(p.e164).toBe("+905321234567");
      expect(p.national).toBe("5321234567");
      expect(p.country).toBe("TR");
      expect(p.kind).toBe("mobile");
    }
  });
  it("KKTC (+90 392) Türkiye gibi sabit hat", () => {
    const p = parsePhone("+90 392 228 12 34");
    expect(p.ok).toBe(true);
    expect(p.stored).toBe("03922281234");
    expect(p.kind).toBe("landline");
  });
  it("yurt içi sabit hat 0XXXXXXXXXX", () => {
    expect(parsePhone("0212 555 11 22").stored).toBe("02125551122");
    expect(parsePhone("0312 555 11 22").kind).toBe("landline");
    expect(parsePhone("0850 123 45 67").ok).toBe(true);
  });
  it("geçersizler", () => {
    for (const g of ["", "   ", "0532", "053212345", "053212345678", "0132 123 45 67", "1234567890", "abc", "0532 123 45 6a", "05321234567x", "0 532 + 123"]) {
      const p = parsePhone(g);
      expect(p.ok, g).toBe(false);
      expect(p.stored).toBe("");
      expect(p.error).toBeTruthy();
    }
  });
  it("saklanan biçim idempotent", () => {
    expect(parsePhone(parsePhone("+90 532 123 45 67").stored).stored).toBe("05321234567");
  });
});

describe("parsePhone - yabancı", () => {
  it("Almanya", () => {
    for (const g of ["+49 151 2345 6789", "004915123456789", "+49 (0)151 23456789", "+49-0151-23456789", "+4915123456789"]) {
      const p = parsePhone(g);
      expect(p.ok, g).toBe(true);
      expect(p.stored, g).toBe("+4915123456789");
      expect(p.country).toBe("DE");
      expect(p.national).toBe("15123456789");
    }
  });
  it("ABD, Rusya, Azerbaycan, BAE", () => {
    expect(parsePhone("+1 212 555 1234").stored).toBe("+12125551234");
    expect(parsePhone("+7 912 345 67 89").country).toBe("RU");
    expect(parsePhone("+7 771 123 4567").country).toBe("KZ");
    expect(parsePhone("+994 50 123 45 67").stored).toBe("+994501234567");
    expect(parsePhone("+971 50 123 4567").country).toBe("AE");
  });
  it("uzunluk sınırları ülkeye göre", () => {
    expect(parsePhone("+1 212 555 123").ok).toBe(false); // 9 hane
    expect(parsePhone("+1 212 555 12345").ok).toBe(false); // 11 hane
    expect(parsePhone("+31 6 1234567").ok).toBe(false);
    expect(parsePhone("+31 6 12345678").ok).toBe(true);
  });
  it("tabloda olmayan kod 7–15 hane E.164 ise kabul (country null)", () => {
    const p = parsePhone("+999 123 4567");
    expect(p.ok).toBe(true);
    expect(p.country).toBeNull();
    expect(p.stored).toBe("+9991234567");
  });
  it("E.164 sınırları", () => {
    expect(parsePhone("+999123").ok).toBe(false); // 6 hane
    expect(parsePhone("+9991234567890123").ok).toBe(false); // 16 hane
    expect(parsePhone("+0 123 456 789").ok).toBe(false);
    expect(parsePhone("+").ok).toBe(false);
    expect(parsePhone("4915123456789 +49").ok).toBe(false);
  });
  it("İtalya'da baştaki 0 korunur", () => {
    expect(parsePhone("+39 06 1234 5678").stored).toBe("+390612345678");
  });
  it("varsayılan ülke seçilebilir", () => {
    expect(parsePhone("0151 2345 6789", "DE").stored).toBe("+4915123456789");
    expect(parsePhone("532 123 45 67", "TR").stored).toBe("05321234567");
    expect(parsePhone("5321234567", "DE").ok).toBe(true); // Almanya 10 hane (min 7)
  });
});

describe("isValidPhone / normalizePhone / toE164Phone", () => {
  it("isValidPhone & isValidOptionalPhone", () => {
    expect(isValidPhone("0532 123 45 67")).toBe(true);
    expect(isValidPhone("+49 151 23456789")).toBe(true);
    expect(isValidPhone("123")).toBe(false);
    expect(isValidOptionalPhone("")).toBe(true);
    expect(isValidOptionalPhone(null)).toBe(true);
    expect(isValidOptionalPhone("12")).toBe(false);
  });
  it("normalizePhone geçersizde eski davranışa düşer", () => {
    expect(normalizePhone("+49 151 23456789")).toBe("+4915123456789");
    expect(normalizePhone("0532 123 45 67")).toBe("05321234567");
    expect(normalizePhone("0532")).toBe("0532");
  });
  it("toE164Phone", () => {
    expect(toE164Phone("05321234567")).toBe("+905321234567");
    expect(toE164Phone("+49 151 23456789")).toBe("+4915123456789");
    expect(toE164Phone("xx")).toBe("");
  });
});

describe("formatPhoneDisplay", () => {
  it("Türkiye", () => {
    expect(formatPhoneDisplay("05321234567")).toBe("0532 123 45 67");
    expect(formatPhoneDisplay("+905321234567")).toBe("0532 123 45 67");
    expect(formatPhoneDisplay("02125551122")).toBe("0212 555 11 22");
  });
  it("yabancı", () => {
    expect(formatPhoneDisplay("+4915123456789")).toBe("+49 151 2345 6789");
    expect(formatPhoneDisplay("+12125551234")).toBe("+1 212 555 1234");
  });
  it("boş ve çözümlenemeyen", () => {
    expect(formatPhoneDisplay("")).toBe("");
    expect(formatPhoneDisplay(null)).toBe("");
    expect(formatPhoneDisplay("abc")).toBe("abc");
  });
});

describe("yabancı numara WhatsApp / tel / normalize", () => {
  it("toWhatsAppMsisdn & link", () => {
    expect(toWhatsAppMsisdn("+4915123456789")).toBe("4915123456789");
    expect(toWhatsAppMsisdn("004915123456789")).toBe("4915123456789");
    expect(toWhatsAppMsisdn("+49 151 2345 6789")).toBe("4915123456789");
    expect(toWhatsAppLink("+4915123456789")).toBe("https://wa.me/4915123456789");
    expect(toWhatsAppLink("+4915123456789", "Merhaba")).toBe("https://wa.me/4915123456789?text=Merhaba");
  });
  it("TR davranışı değişmedi", () => {
    expect(toWhatsAppMsisdn("05321234567")).toBe("905321234567");
    expect(toWhatsAppMsisdn("+905321234567")).toBe("905321234567");
    expect(toWhatsAppMsisdn("0090 532 123 45 67")).toBe("905321234567");
    expect(toTelHref("05321234567")).toBe("tel:05321234567");
  });
  it("toTelHref yabancı", () => {
    expect(toTelHref("+4915123456789")).toBe("tel:+4915123456789");
  });
  it("normalizeTurkishPhone yabancıyı bozmaz", () => {
    expect(normalizeTurkishPhone("+49 151 23456789")).toBe("+4915123456789");
    expect(normalizeTurkishPhone("+905321234567")).toBe("05321234567");
  });
});

describe("interpretPhoneEntry (canlı giriş)", () => {
  it("harfleri atar", () => {
    expect(interpretPhoneEntry("5a3b2", "TR").digits).toBe("0532");
    expect(interpretPhoneEntry("1a5b1", "DE").digits).toBe("151");
  });
  it("+90 / 0090 yapıştırılırsa TR'ye geçer", () => {
    expect(interpretPhoneEntry("+90 532 123 45 67", "DE")).toEqual({ country: "TR", digits: "05321234567", pending: null });
    expect(interpretPhoneEntry("0090 532 123 45 67", "DE").country).toBe("TR");
    expect(interpretPhoneEntry("905321234567", "TR").digits).toBe("05321234567");
  });
  it("+49 yapıştırılırsa Almanya", () => {
    expect(interpretPhoneEntry("+49 151 23456789", "TR")).toEqual({ country: "DE", digits: "15123456789", pending: null });
    expect(interpretPhoneEntry("0049 151 23456789", "TR").country).toBe("DE");
  });
  it("tamamlanmamış kod taslak kalır", () => {
    expect(interpretPhoneEntry("+", "TR")).toEqual({ country: "TR", digits: "", pending: "" });
    expect(interpretPhoneEntry("+9", "TR").pending).toBe("9");
  });
  it("yabancıda trunk 0 atılır ve uzunluk sınırlanır", () => {
    expect(interpretPhoneEntry("01512345", "DE").digits).toBe("1512345");
    expect(interpretPhoneEntry("123456789012345678", "US").digits).toHaveLength(10);
  });
});
