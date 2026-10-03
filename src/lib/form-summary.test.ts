import { describe, expect, it } from "vitest";
import { cleanLabel, fieldDisplay, formatDateValue } from "./form-summary";

describe("fieldDisplay", () => {
  it("boş değer -> null", () => {
    expect(fieldDisplay("notes", { kind: "text", raw: "  " })).toBeNull();
    expect(fieldDisplay("notes", { kind: "text", raw: null })).toBeNull();
  });
  it("telefon biçimlenir, e-posta olduğu gibi", () => {
    expect(fieldDisplay("phone", { kind: "text", raw: "05321234567" })).toBe("0532 123 45 67");
    expect(fieldDisplay("email", { kind: "text", raw: "a@b.com" })).toBe("a@b.com");
  });
  it("seçimler etiketle (il/ilçe/mahalle)", () => {
    expect(fieldDisplay("province_id", { kind: "select", raw: "34", selectedLabel: " İstanbul " })).toBe("İstanbul");
    expect(fieldDisplay("district_id", { kind: "select", raw: "", selectedLabel: "İlçe seçin" })).toBeNull();
  });
  it("onay kutusu Evet/Hayır, tarih biçimi", () => {
    expect(fieldDisplay("x", { kind: "checkbox", raw: "on", checked: true })).toBe("Evet");
    expect(fieldDisplay("x", { kind: "checkbox", raw: null, checked: false })).toBe("Hayır");
    expect(fieldDisplay("birth_date", { kind: "text", raw: "1990-02-03" })).toBe("03.02.1990");
  });
  it("formatDateValue ve cleanLabel", () => {
    expect(formatDateValue("2026-10-03T14:30")).toBe("03.10.2026 14:30");
    expect(formatDateValue("abc")).toBeNull();
    expect(cleanLabel(" Ad soyad * ")).toBe("Ad soyad");
    expect(cleanLabel("*")).toBeNull();
  });
});

describe("gizli alanlar (istisna)", () => {
  it("parola/OTP/token/API anahtarı değeri asla gösterilmez", () => {
    expect(fieldDisplay("temp_password", { kind: "text", raw: "Abc123!x" })).toBe("Girildi");
    expect(fieldDisplay("otp_code", { kind: "text", raw: "123456" })).toBe("Girildi");
    expect(fieldDisplay("api_key", { kind: "text", raw: "sk-live" })).toBe("Girildi");
    expect(fieldDisplay("x", { kind: "text", raw: "gizli", secret: true })).toBe("Girildi");
    expect(fieldDisplay("temp_password", { kind: "text", raw: "" })).toBeNull();
  });
  it("not gibi alanlar olduğu gibi görünür", () => {
    expect(fieldDisplay("notes", { kind: "text", raw: "  Ali   bey aradı " })).toBe("Ali bey aradı");
  });
});
