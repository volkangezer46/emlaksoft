import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callerRedirectPath, looksLikePhone, phoneSearchNeedle } from "@/lib/caller-lookup";

describe("arayan tanıma — telefon arama anahtarı", () => {
  it("telefon biçimleri tanınır; ad/e-posta/kısa sayı telefon sayılmaz", () => {
    for (const s of ["0532 123 45 67", "+90 (532) 123-45-67", "5321234567", "+49 151 23456789", "123 45 67"]) expect(looksLikePhone(s), s).toBe(true);
    for (const s of ["Ayşe 0532", "ayse@ornek.com", "12345", ""]) expect(looksLikePhone(s), s).toBe(false);
  });

  it("TR tam numara: saklama biçimi 05… ve yerel 10 hane iğne (her yazım biçimi aynı sonuç)", () => {
    for (const s of ["0532 123 45 67", "+90 532 123 45 67", "905321234567", "(532) 123 4567"]) {
      expect(phoneSearchNeedle(s), s).toEqual({ stored: "05321234567", needle: "5321234567" });
    }
  });

  it("yabancı numara: +E.164 saklama, ülke kodlu rakam iğnesi", () => {
    const n = phoneSearchNeedle("+49 151 23456789");
    expect(n?.stored).toBe("+4915123456789");
    expect(n?.needle).toBe("4915123456789");
  });

  it("kısmi numara: son rakamlarla arar, saklama biçimi yok", () => {
    expect(phoneSearchNeedle("123 45 67")).toEqual({ stored: null, needle: "1234567" });
    expect(phoneSearchNeedle("ad")).toBeNull();
  });

  it("kısayol hedefi: tek → kart, yok → numaralı yeni müşteri, çok → arama sonuçları", () => {
    const n = { stored: "05321234567", needle: "5321234567" };
    expect(callerRedirectPath([{ id: "a" }], n)).toBe("/app/musteriler/a");
    expect(callerRedirectPath([], n)).toBe("/app/musteriler/yeni?phone=05321234567");
    expect(callerRedirectPath([{ id: "a" }, { id: "b" }], n)).toBe("/app/arama-sonuclari?q=5321234567");
    expect(callerRedirectPath([], { stored: null, needle: "1234567" })).toBe("/app/arama-sonuclari?q=1234567");
  });

  it("üst çubuk araması ve /app/ara aynı anahtarı kullanır; kısayol sayfa değil yönlendirmedir (menü dışı)", () => {
    expect(readFileSync("src/app/actions/search.ts", "utf8")).toContain("phoneSearchNeedle(q)");
    const route = readFileSync("src/app/app/ara/route.ts", "utf8");
    expect(route).toContain("phoneSearchNeedle(");
    expect(route).toContain('requirePermission("customers", "view")');
    expect(route).toContain("hasOfficeWideDataScope");
  });
});
