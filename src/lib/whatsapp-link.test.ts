import { describe, expect, it } from "vitest";
import { buildWhatsAppLink, buildWhatsAppShareLink, normalizeWhatsAppNumber } from "./whatsapp-link";

describe("buildWhatsAppShareLink", () => {
  it("alıcısız paylaşım linki", () => {
    expect(buildWhatsAppShareLink("a b")).toBe("https://wa.me/?text=a%20b");
    expect(buildWhatsAppShareLink("  ")).toBeNull();
  });
});

describe("normalizeWhatsAppNumber", () => {
  it.each([
    "0532 123 45 67",
    "532-123-45-67",
    "+90 532 123 45 67",
    "00905321234567",
    "905321234567",
    "5321234567",
  ])("%s -> 905321234567", (v) => {
    expect(normalizeWhatsAppNumber(v)).toBe("905321234567");
  });
  it.each(["", null, undefined, "123", "02121234567", "0532 123 45"])("geçersiz: %s", (v) => {
    expect(normalizeWhatsAppNumber(v)).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("mesajı kodlar", () => {
    expect(buildWhatsAppLink("05321234567", "Merhaba & selam")).toBe(
      "https://wa.me/905321234567?text=Merhaba%20%26%20selam",
    );
  });
  it("mesaj yoksa yalnız numara", () => {
    expect(buildWhatsAppLink("05321234567")).toBe("https://wa.me/905321234567");
  });
  it("geçersiz numara null", () => {
    expect(buildWhatsAppLink("abc", "x")).toBeNull();
  });
});
