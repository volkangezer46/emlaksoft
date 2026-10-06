import { describe, expect, it } from "vitest";
import { computePriceHealth, priceHealthProvenance, priceHealthSourceLabel } from "@/lib/price-health";

describe("fiyat sağlığı kaynak etiketi (referans modeli = düşük güven)", () => {
  const base = { listPrice: 5_000_000, sqm: 100, districtHint: "Bağcılar", transactionType: "sale" };

  it("sabit il/ilçe tablosu kaynaklıysa 'referans_modeli' ve DÜŞÜK güven", () => {
    const r = computePriceHealth(base);
    expect(r.source).toBe("referans_modeli");
    expect(r.confidence).toBe("dusuk");
    expect(priceHealthSourceLabel(r.source)).toContain("düşük güven");
  });

  it("canlı/emsal m² fiyatı verilirse 'emsal' ve orta güven", () => {
    const r = computePriceHealth({ ...base, overrideSqmPrice: 50_000 });
    expect(r.source).toBe("emsal");
    expect(r.confidence).toBe("orta");
    expect(priceHealthSourceLabel(r.source)).toBe("Kaynak: emsal");
  });

  it("hesaplanamadığında kaynak 'yok', güven null", () => {
    expect(computePriceHealth({ ...base, listPrice: null }).source).toBe("yok");
    expect(computePriceHealth({ ...base, sqm: null }).confidence).toBeNull();
  });

  it("mevcut alanlar değişmedi (geriye uyumlu)", () => {
    const r = computePriceHealth(base);
    expect(r.mid).toBe(9_500_000);
    expect(["green", "yellow", "red"]).toContain(r.health);
    expect(r.note).toContain("Satış modeli");
  });

  it("provenance yardımcısı", () => {
    expect(priceHealthProvenance(true)).toEqual({ source: "emsal", confidence: "orta" });
    expect(priceHealthProvenance(false)).toEqual({ source: "referans_modeli", confidence: "dusuk" });
  });
});
