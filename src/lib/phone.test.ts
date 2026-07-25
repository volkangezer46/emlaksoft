import { describe, expect, it } from "vitest";
import {
  formatTurkishPhone,
  isValidOptionalTurkishMobile,
  isValidTurkishMobile,
  normalizeTurkishPhone,
  sanitizeTurkishPhoneInput,
  toE164TurkishPhone,
  toTelHref,
  toWhatsAppLink,
  toWhatsAppMsisdn,
} from "./phone";

/**
 * Telefon normalizasyonu bu sistemde KRİTİK: numara hem DB anahtarı gibi
 * kullanılıyor (müşteri arama, çağrı eşleştirme) hem de dış servislere
 * (WhatsApp, iyzico, SMS) gidiyor. Tek haneli bir kayma yanlış kişiye mesaj
 * göndermek demek.
 */

const HEDEF = "05321234567";

describe("normalizeTurkishPhone", () => {
  it("aynı numaranın tüm yazımlarını tek biçime indirir", () => {
    for (const girdi of [
      "05321234567",
      "0532 123 45 67",
      "+90 532 123 45 67",
      "+905321234567",
      "905321234567",
      "5321234567",
      "0090 532 123 45 67",
      "(0532) 123-45-67",
    ]) {
      expect(normalizeTurkishPhone(girdi)).toBe(HEDEF);
    }
  });

  it("11 haneden uzun girdiyi keser", () => {
    expect(normalizeTurkishPhone("053212345679999")).toBe(HEDEF);
  });

  it("null/undefined/boş için boş dizge", () => {
    expect(normalizeTurkishPhone(null)).toBe("");
    expect(normalizeTurkishPhone(undefined)).toBe("");
    expect(normalizeTurkishPhone("   ")).toBe("");
  });

  it("harf içeren girdiden yalnızca rakamları alır", () => {
    expect(normalizeTurkishPhone("tel: 0532-123-45-67 (cep)")).toBe(HEDEF);
  });
});

describe("sanitizeTurkishPhoneInput", () => {
  it("başa 0 ekler", () => {
    expect(sanitizeTurkishPhoneInput("532")).toBe("0532");
  });

  it("en fazla 11 hane tutar", () => {
    expect(sanitizeTurkishPhoneInput("05321234567890")).toHaveLength(11);
  });

  it("boş girdide boş kalır (kullanıcı hepsini silebilsin)", () => {
    expect(sanitizeTurkishPhoneInput("")).toBe("");
    expect(sanitizeTurkishPhoneInput("abc")).toBe("");
  });

  it("zaten 0 ile başlayanı bozmaz", () => {
    expect(sanitizeTurkishPhoneInput("0532")).toBe("0532");
  });
});

describe("isValidTurkishMobile", () => {
  it("geçerli cep numaralarını kabul eder", () => {
    expect(isValidTurkishMobile("05321234567")).toBe(true);
    expect(isValidTurkishMobile("+90 532 123 45 67")).toBe(true);
  });

  it("sabit hattı reddeder (05 ile başlamıyor)", () => {
    expect(isValidTurkishMobile("02121234567")).toBe(false);
  });

  it("eksik haneyi reddeder", () => {
    expect(isValidTurkishMobile("0532123456")).toBe(false);
  });

  it("boş/null reddeder", () => {
    expect(isValidTurkishMobile("")).toBe(false);
    expect(isValidTurkishMobile(null)).toBe(false);
  });
});

describe("isValidOptionalTurkishMobile", () => {
  it("boşu geçerli sayar", () => {
    expect(isValidOptionalTurkishMobile("")).toBe(true);
    expect(isValidOptionalTurkishMobile("   ")).toBe(true);
    expect(isValidOptionalTurkishMobile(null)).toBe(true);
  });

  it("doluysa formatı zorunlu kılar", () => {
    expect(isValidOptionalTurkishMobile("123")).toBe(false);
    expect(isValidOptionalTurkishMobile("05321234567")).toBe(true);
  });
});

describe("formatTurkishPhone", () => {
  it("tam numarayı 4-3-2-2 gruplar", () => {
    expect(formatTurkishPhone(HEDEF)).toBe("0532 123 45 67");
  });

  it("yarım numarayı da okunur biçimde gösterir", () => {
    expect(formatTurkishPhone("0532")).toBe("0532");
    expect(formatTurkishPhone("0532123")).toBe("0532 123");
    expect(formatTurkishPhone("053212345")).toBe("0532 123 45");
  });

  it("boşta boş döner", () => {
    expect(formatTurkishPhone(null)).toBe("");
  });
});

describe("dış servis biçimleri", () => {
  it("E.164 üretir", () => {
    expect(toE164TurkishPhone(HEDEF)).toBe("+905321234567");
    expect(toE164TurkishPhone("0532 123 45 67")).toBe("+905321234567");
  });

  it("WhatsApp msisdn'i +'sız verir", () => {
    expect(toWhatsAppMsisdn(HEDEF)).toBe("905321234567");
  });

  it("WhatsApp linkinde mesajı URL-kodlar", () => {
    const link = toWhatsAppLink(HEDEF, "Merhaba & hoş geldiniz");
    expect(link).toBe("https://wa.me/905321234567?text=Merhaba%20%26%20ho%C5%9F%20geldiniz");
  });

  it("mesajsız WhatsApp linki sorgu parçası taşımaz", () => {
    expect(toWhatsAppLink(HEDEF)).toBe("https://wa.me/905321234567");
  });

  it("geçersiz numarada link/href üretmez (null)", () => {
    // Bozuk numarayla wa.me linki üretmek yanlış kişiye yönlendirme riski.
    expect(toWhatsAppLink(null)).toBeNull();
    expect(toTelHref("")).toBeNull();
  });

  it("tel: href'i ulusal formatta verir", () => {
    expect(toTelHref("+905321234567")).toBe("tel:05321234567");
  });

  it("boş numarada E.164 boş döner, '+90' gibi yarım değer üretmez", () => {
    expect(toE164TurkishPhone(null)).toBe("");
    expect(toWhatsAppMsisdn("")).toBe("");
  });
});
