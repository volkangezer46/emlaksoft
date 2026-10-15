import { describe, expect, it } from "vitest";
import { checkPasswordPolicy, normalizePasswordText, passwordPolicyError } from "./password-policy";

const issue = (pw: string, ctx = {}) => {
  const r = checkPasswordPolicy(pw, ctx);
  return r.ok ? null : r.issue;
};

describe("parola politikası", () => {
  it("uzunluk sınırları", () => {
    expect(issue("Kx9!a2")).toBe("too_short");
    expect(issue("a".repeat(129))).toBe("too_long");
  });

  it("dizi ve tekrarlar reddedilir", () => {
    for (const pw of ["12345678", "87654321", "aaaaaaaa", "abababab", "qwertyuiop", "asdfghjkl", "abcabcabc", "12341234", "sifresifre"]) {
      expect(issue(pw)).toBe("sequence");
    }
  });

  it("yaygın ve Türkiye'ye özgü zayıf kökler (rakam/sembol ekiyle de) reddedilir", () => {
    for (const pw of [
      "password1",
      "P@ssw0rd!",
      "Galatasaray1905",
      "fenerbahce1907",
      "Beşiktaş1903!",
      "şifre12345",
      "istanbul34",
      "Ataturk1881",
      "emlak2024",
      "qwe123456",
      "abc123456",
    ]) {
      expect(issue(pw), pw).toBe("common");
    }
  });

  it("e-posta, ad ve ofis adı parolada geçemez", () => {
    expect(issue("ahmetyilmaz!42", { email: "ahmet.yilmaz@gmail.com" })).toBe("contains_email");
    expect(issue("Kuzey-Ofis-2024x", { email: "info@kuzeyofis.com.tr" })).toBe("contains_email");
    expect(issue("Hilal.Demirtas77", { fullName: "Hilal Demirtaş" })).toBe("contains_name");
    expect(issue("Marmaris!Deniz9", { officeName: "Marmaris Deniz Emlak" })).toBe("contains_office");
  });

  it("genel e-posta sağlayıcısı ve genel ofis kelimeleri tek başına ihlal sayılmaz", () => {
    expect(issue("Gmailx!Kirmizi7Lale", { email: "x@gmail.com" })).toBeNull();
    expect(issue("Kirmizi7Lale!Gayrimenkul", { officeName: "Akdeniz Gayrimenkul" })).toBeNull();
  });

  it("güçlü parola geçer", () => {
    expect(passwordPolicyError("Mavi-Kedi-Bodrum-88", { email: "a@b.com", fullName: "Ece Su", officeName: "Ege Emlak" })).toBeNull();
    expect(passwordPolicyError("tr7#kLm2vQ")).toBeNull();
  });

  it("Türkçe normalizasyon", () => {
    expect(normalizePasswordText("ŞİFRE Çığ-Öğün")).toBe("sifrecigogun");
  });
});
