import { describe, expect, it } from "vitest";
import { priceHealthLabel, propertyStatusLabel } from "./property-labels";

describe("portföy etiketleri", () => {
  it("durum ham değerleri Türkçe'ye çevrilir", () => {
    expect(propertyStatusLabel("rented")).toBe("Kiralandı");
    expect(propertyStatusLabel("sold")).toBe("Satıldı");
    expect(propertyStatusLabel("live")).toBe("Yayında");
    expect(propertyStatusLabel("draft")).toBe("Taslak");
    expect(propertyStatusLabel(null)).toBe("Belirsiz");
    expect(propertyStatusLabel("Özel Durum")).toBe("Özel Durum");
  });

  it("fiyat sağlığı Türkçe'ye çevrilir", () => {
    expect(priceHealthLabel("green")).toBe("Uygun");
    expect(priceHealthLabel("Sarı")).toBe("İzlenmeli");
    expect(priceHealthLabel("red")).toBe("Riskli");
    expect(priceHealthLabel(null)).toBe("Bekliyor");
    expect(priceHealthLabel("pending")).toBe("Bekliyor");
  });
});
