import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMatchShareMessage, toSmsHref } from "@/lib/match-share-message";

describe("eşleşmeyi müşteriye gönder", () => {
  it("mesaj: ilk ad, başlık, liste fiyatı, bağlantı, imza; telefon/kişisel veri yok", () => {
    const m = buildMatchShareMessage({
      customerName: "Ayşe Yılmaz",
      propertyTitle: "Moda 3+1",
      propertyCode: "P-1",
      listPrice: 5_000_000,
      url: "https://emlaksoft.vercel.app/paylas/abc",
      advisorName: "Can Demir",
      officeName: "Deniz Emlak",
    });
    expect(m).toContain("Merhaba Ayşe,");
    expect(m).not.toContain("Yılmaz");
    expect(m).toContain('"Moda 3+1"');
    expect(m).toContain("https://emlaksoft.vercel.app/paylas/abc");
    expect(m).toContain("Can Demir · Deniz Emlak");
  });
  it("başlık yoksa kod; ad yoksa selam sade", () => {
    const m = buildMatchShareMessage({ customerName: null, propertyTitle: "", propertyCode: "P-9", listPrice: null, url: "u", advisorName: null, officeName: null });
    expect(m.startsWith("Merhaba,")).toBe(true);
    expect(m).toContain('"P-9"');
  });
  it("SMS bağlantısı: numara yoksa null, gövde kodlanır", () => {
    expect(toSmsHref(null, "x")).toBeNull();
    expect(toSmsHref("0532 123 45 67", "a b")).toBe("sms:05321234567?&body=a%20b");
  });
  it("paylaşım bağlantısı tek yardımcıdan (portföy detayı ve eşleştirme); eylem iki kapılı (matching:create + properties:edit = RLS)", () => {
    expect(readFileSync("src/app/actions/shares.ts", "utf8")).toContain("insertPropertyShareLink(");
    const m = readFileSync("src/app/actions/matching.ts", "utf8");
    expect(m).toContain("insertPropertyShareLink(");
    expect(m).toContain('requirePermission("properties", "edit")');
    expect(m).toContain('action: "match.sent"');
  });
});
