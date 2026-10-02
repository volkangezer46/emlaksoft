import { describe, expect, it } from "vitest";
import { generateListingText } from "./listing-text";

describe("generateListingText", () => {
  it("dolu portföyden başlık ve açıklama üretir", () => {
    const r = generateListingText({
      transaction_type: "Satılık",
      property_type: "Daire",
      list_price: 3500000,
      district: "Kadıköy",
      province: "İstanbul",
      features: { rooms: "3+1", sqm: 120, floor: 4 },
    });
    expect(r.title).toBe("Kadıköy Satılık 3+1 Daire 120 m²");
    expect(r.description).toContain("• Alan: 120 m²");
    expect(r.description).toContain("• Bulunduğu kat: 4");
    expect(r.description).toContain("3.500.000 ₺");
    expect(r.warnings).toEqual([]);
  });

  it("eksik alanları atlar, uydurmaz", () => {
    const r = generateListingText({ transaction_type: "Kiralık", property_type: "Arsa" });
    expect(r.title).toBe("Kiralık Arsa");
    expect(r.description).not.toMatch(/Isıtma|Oda|Fiyat|Alan/);
  });

  it("boş girdide uyarı verir", () => {
    const r = generateListingText({});
    expect(r.title).toBe("");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("uzun başlıkta portal uyarısı verir", () => {
    const r = generateListingText({
      transaction_type: "Satılık",
      property_type: "Villa",
      district: "Çok uzun bir ilçe adı örneği burada devam ediyor",
      province: "X",
      features: { rooms: "6+2", sqm: 400 },
    });
    expect(r.warnings.some((w) => w.includes("Sahibinden"))).toBe(true);
  });
});
