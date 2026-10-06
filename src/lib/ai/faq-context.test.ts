import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAQ, FAQ_PRICE_PATTERN } from "@/lib/help-faq";
import { faqContextForMessages, faqContextText, selectFaqForQuestion, tokenize } from "./faq-context";

describe("faq-context seçici", () => {
  it("ilgisiz soruda hiçbir kayıt eklenmez (uydurma yönlendirme yok)", () => {
    expect(selectFaqForQuestion("bugün hava nasıl olacak")).toEqual([]);
    expect(faqContextText([])).toBe("");
    expect(faqContextForMessages([{ role: "user", content: "merhaba" }])).toBe("");
  });

  it("bir SSS başlığından türetilen soru o kaydı bulur", () => {
    const item = FAQ.find((f) => !FAQ_PRICE_PATTERN.test(f.q) && !FAQ_PRICE_PATTERN.test(f.a))!;
    const hits = selectFaqForQuestion(item.q);
    expect(hits.map((h) => h.item.id)).toContain(item.id);
  });

  it("fiyat/tutar içeren kayıt asla beslenmez", () => {
    const priced = { id: "x", category: "paket" as const, q: "Paket ücreti nedir", a: "Aylık 749 TL ücret", href: "/fiyatlar" };
    expect(selectFaqForQuestion("paket ücreti nedir", [priced])).toEqual([]);
  });

  it("bağlam bloğu yanıtı ve sayfa bağlantısını taşır, uydurmayı yasaklar", () => {
    const item = { id: "t", category: "baslangic" as const, q: "Müşterileri Excel ile nasıl içe aktarırım", a: "Müşteriler sayfasından içe aktarma sihirbazını açın.", href: "/app/musteriler" };
    const hits = selectFaqForQuestion("Excel ile müşteri içe aktarma nasıl yapılır?", [item]);
    expect(hits).toHaveLength(1);
    const text = faqContextText(hits);
    expect(text).toContain("ÜRÜN KULLANIM BİLGİSİ");
    expect(text).toContain("/app/musteriler");
    expect(text).toContain("uydurma");
  });

  it("belirteçler Türkçe küçük harfe çevrilir, kısa/dolgu sözcükler atılır, kaba kök alınır", () => {
    expect(tokenize("İçe AKTARMA ve bir")).toEqual(["içe", "aktar"]);
    expect(tokenize("ve bir bu")).toEqual([]);
  });
});

describe("AI sınırı", () => {
  it("faq-context ağ/AI çağrısı içermez", () => {
    const src = readFileSync("src/lib/ai/faq-context.ts", "utf8");
    expect(src).not.toMatch(/api\.openai\.com|fetch\(/);
  });
});
